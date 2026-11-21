#!/usr/bin/env python3
"""
Copy the Farmley OEE database from the egress-restricted Supabase project into
a fresh one, over a direct Postgres connection. Data goes machine-to-machine;
it is never written to an intermediate file.

    pip install "psycopg[binary]"

    # Supabase dashboard -> Connect -> Session pooler -> URI, for each project.
    # Use the pooler URI, not db.<ref>.supabase.co (that one is IPv6-only on
    # the free plan). Reset the database password if you don't have it.
    set SRC_DSN=postgresql://postgres.<old-ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres
    set DST_DSN=postgresql://postgres.<new-ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres

    python migrate.py --check     # connect to both, print row counts, change nothing
    python migrate.py --schema    # apply 01_schema.sql to the destination
    python migrate.py --data      # copy every table
    python migrate.py --all       # schema then data

The destination must be an empty project: --data clears each destination table
before filling it.
"""

import argparse
import json
import os
import pathlib
import sys

try:
    import psycopg
except ImportError:
    sys.exit('psycopg is not installed. Run:  pip install "psycopg[binary]"')

HERE = pathlib.Path(__file__).resolve().parent
SCHEMA_FILE = HERE / '01_schema.sql'
DUMP_DIR = pathlib.Path(os.environ.get('DUMP_DIR') or (HERE / 'dump'))

# Copied in this order so foreign keys always resolve.
# (schema, table) -> columns are discovered at run time.
TABLES = [
    ('public', 'plants'),
    ('public', 'lines'),
    ('public', 'machines'),
    ('public', 'machine_status_defaults'),
    ('auth',   'users'),
    ('auth',   'identities'),
    ('public', 'profiles'),
    ('public', 'user_plants'),
    ('public', 'oee_records'),
]


def columns(conn, schema, table):
    """Real, writable columns - generated ones (auth.users.confirmed_at,
    auth.identities.email) cannot be inserted into."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select column_name
            from information_schema.columns
            where table_schema = %s and table_name = %s
              and is_generated = 'NEVER'
              and is_identity  = 'NO'
            order by ordinal_position
            """,
            (schema, table),
        )
        return [r[0] for r in cur.fetchall()]


def count(conn, schema, table):
    with conn.cursor() as cur:
        cur.execute(f'select count(*) from {schema}.{table}')
        return cur.fetchone()[0]


def table_exists(conn, schema, table):
    with conn.cursor() as cur:
        cur.execute(
            'select to_regclass(%s) is not null', (f'{schema}.{table}',)
        )
        return cur.fetchone()[0]


def apply_schema(dst):
    if not SCHEMA_FILE.exists():
        sys.exit(f'missing {SCHEMA_FILE}')
    sql = SCHEMA_FILE.read_text(encoding='utf-8')
    print(f'applying {SCHEMA_FILE.name} ({len(sql):,} bytes) ...')
    with dst.cursor() as cur:
        cur.execute(sql)
    dst.commit()
    print('  schema applied')


def copy_table(src, dst, schema, table):
    if not table_exists(src, schema, table):
        print(f'  {schema}.{table}: not in source, skipped')
        return
    if not table_exists(dst, schema, table):
        print(f'  {schema}.{table}: NOT IN DESTINATION - run --schema first')
        return

    # Only columns both sides have, so a newer GoTrue on the destination
    # (extra or dropped auth columns) does not break the copy.
    src_cols = columns(src, schema, table)
    dst_cols = set(columns(dst, schema, table))
    cols = [c for c in src_cols if c in dst_cols]
    dropped = [c for c in src_cols if c not in dst_cols]

    col_sql = ', '.join(f'"{c}"' for c in cols)
    n = count(src, schema, table)

    with dst.cursor() as cur:
        # profiles gets rows from the on_auth_user_created trigger when
        # auth.users is copied; clear them so the real roles land intact.
        cur.execute(f'delete from {schema}.{table}')

        with src.cursor().copy(
            f'copy (select {col_sql} from {schema}.{table}) to stdout (format binary)'
        ) as reader, cur.copy(
            f'copy {schema}.{table} ({col_sql}) from stdin (format binary)'
        ) as writer:
            for block in reader:
                writer.write(block)

    dst.commit()
    got = count(dst, schema, table)
    flag = 'OK ' if got == n else '!! '
    note = f'   (source-only columns ignored: {", ".join(dropped)})' if dropped else ''
    print(f'  {flag}{schema}.{table}: {got:,} / {n:,} rows{note}')
    return got == n


def dump_table(src, schema, table):
    """Binary COPY straight to a local file, plus a sidecar naming the columns
    and the row count, so --load can reproduce it exactly."""
    if not table_exists(src, schema, table):
        print(f'  {schema}.{table}: not in source, skipped')
        return

    cols = columns(src, schema, table)
    col_sql = ', '.join(f'"{c}"' for c in cols)
    n = count(src, schema, table)
    path = DUMP_DIR / f'{schema}.{table}.bin'

    written = 0
    with open(path, 'wb') as fh, src.cursor().copy(
        f'copy (select {col_sql} from {schema}.{table}) to stdout (format binary)'
    ) as reader:
        for block in reader:
            fh.write(block)
            written += len(block)

    (DUMP_DIR / f'{schema}.{table}.json').write_text(
        json.dumps({'columns': cols, 'rows': n}), encoding='utf-8'
    )
    print(f'  {schema}.{table}: {n:,} rows -> {path.name} ({written:,} bytes)')


def load_table(dst, schema, table):
    path = DUMP_DIR / f'{schema}.{table}.bin'
    meta_path = DUMP_DIR / f'{schema}.{table}.json'
    if not path.exists() or not meta_path.exists():
        print(f'  {schema}.{table}: no dump file, skipped')
        return
    if not table_exists(dst, schema, table):
        print(f'  {schema}.{table}: NOT IN DESTINATION - run --schema first')
        return False

    meta = json.loads(meta_path.read_text(encoding='utf-8'))
    dst_cols = set(columns(dst, schema, table))
    missing = [c for c in meta['columns'] if c not in dst_cols]
    if missing:
        print(f'  !! {schema}.{table}: destination lacks {", ".join(missing)}')
        return False

    col_sql = ', '.join(f'"{c}"' for c in meta['columns'])
    with dst.cursor() as cur:
        cur.execute(f'delete from {schema}.{table}')
        with open(path, 'rb') as fh, cur.copy(
            f'copy {schema}.{table} ({col_sql}) from stdin (format binary)'
        ) as writer:
            while True:
                block = fh.read(1 << 20)
                if not block:
                    break
                writer.write(block)
    dst.commit()

    got = count(dst, schema, table)
    ok = got == meta['rows']
    print(f'  {"OK " if ok else "!! "}{schema}.{table}: {got:,} / {meta["rows"]:,} rows')
    return ok


def clear_destination(dst):
    """Empty every target table in reverse foreign-key order, so a second run
    is not blocked by references from tables copied later."""
    with dst.cursor() as cur:
        for schema, table in reversed(TABLES):
            if table_exists(dst, schema, table):
                cur.execute(f'delete from {schema}.{table}')
    dst.commit()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--schema', action='store_true')
    ap.add_argument('--data', action='store_true')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--dump', action='store_true',
                    help='SRC_DSN only: copy every table to local files')
    ap.add_argument('--load', action='store_true',
                    help='DST_DSN only: apply schema, then load those files')
    args = ap.parse_args()

    if not any([args.check, args.schema, args.data, args.all, args.dump, args.load]):
        ap.error('pick one of --check / --dump / --load / --schema / --data / --all')

    src_dsn = os.environ.get('SRC_DSN')
    dst_dsn = os.environ.get('DST_DSN')

    # --dump reads the old project only; --load writes the new one only. That
    # split matters because freeing a Free-plan project slot means pausing the
    # source, so the data has to be on disk before the destination can exist.
    if args.dump:
        if not src_dsn:
            sys.exit('set SRC_DSN in the environment first')
        DUMP_DIR.mkdir(parents=True, exist_ok=True)
        print(f'connecting to source ...\ndumping to {DUMP_DIR}')
        src = psycopg.connect(src_dsn, connect_timeout=30)
        try:
            for schema, table in TABLES:
                dump_table(src, schema, table)
            print('\ndump complete - the data is now on disk.')
        finally:
            src.close()
        return

    if args.load:
        if not dst_dsn:
            sys.exit('set DST_DSN in the environment first')
        if not DUMP_DIR.exists():
            sys.exit(f'no dump directory at {DUMP_DIR} - run --dump first')
        print('connecting to destination ...')
        dst = psycopg.connect(dst_dsn, connect_timeout=30)
        try:
            apply_schema(dst)
            print('\nclearing destination ...')
            clear_destination(dst)
            print('loading data ...')
            results = [load_table(dst, s, t) for s, t in TABLES]
            if all(r is not False for r in results):
                print('\nall tables loaded with matching row counts.')
            else:
                print('\nSOME TABLES DID NOT MATCH - see the !! lines above.')
        finally:
            dst.close()
        return

    if not src_dsn or not dst_dsn:
        sys.exit('set SRC_DSN and DST_DSN in the environment first')

    print('connecting to source ...')
    src = psycopg.connect(src_dsn, connect_timeout=30)
    print('connecting to destination ...')
    dst = psycopg.connect(dst_dsn, connect_timeout=30)

    try:
        if args.check:
            print('\nsource row counts:')
            for schema, table in TABLES:
                if table_exists(src, schema, table):
                    print(f'  {schema}.{table}: {count(src, schema, table):,}')
                else:
                    print(f'  {schema}.{table}: missing')
            print('\ndestination row counts:')
            for schema, table in TABLES:
                if table_exists(dst, schema, table):
                    print(f'  {schema}.{table}: {count(dst, schema, table):,}')
                else:
                    print(f'  {schema}.{table}: missing (schema not applied yet)')
            return

        if args.schema or args.all:
            apply_schema(dst)

        if args.data or args.all:
            print('\nclearing destination ...')
            clear_destination(dst)
            print('copying data ...')
            results = [copy_table(src, dst, s, t) for s, t in TABLES]
            if all(r is not False for r in results):
                print('\nall tables copied with matching row counts.')
            else:
                print('\nSOME TABLES DID NOT MATCH - see the !! lines above.')
    finally:
        src.close()
        dst.close()


if __name__ == '__main__':
    main()
