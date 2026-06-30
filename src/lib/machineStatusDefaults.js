// ============================================================================
// Default "Machine Status" per Plant + Line + Machine + Shift.
//
// The combos listed below default to "Not Planned for Production"; every other
// combo defaults to "Running / Planned for Production". The default only
// pre-selects the dropdown — operators can still change it on any entry.
// ============================================================================

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^purnea$/, 'purnia')

export const MACHINE_STATUS_RUNNING = 'Running / Planned for Production'
export const MACHINE_STATUS_NOT_PLANNED = 'Not Planned for Production'

// [Plant, Line, Machine, Shift] -> defaults to "Not Planned for Production".
const notPlannedRows = [
  ['Kundli', 'Packing Line', 'FlowWrap Machine 4', 'Day'],
  ['Kundli', 'Packing Line', 'Tin Seaming', 'Day'],
  ['Kundli', 'Packing Line', 'Srp Machine', 'Day'],
  ['Kundli', 'Mixing Line', 'kadhai 5', 'Day'],
  ['Indore', 'Packing Line', 'Contimix PFS', 'Day'],
  ['Indore', 'Packing Line', 'Contimix FFS', 'Day'],
  ['Indore', 'Packing Line', 'Roboarm Airlines', 'Day'],
  ['Indore', 'Packing Line', 'PFS3', 'Day'],
  ['Indore', 'Packing Line', 'LD Pack of 2', 'Day'],
  ['Indore', 'Packing Line', 'LD Pack of 4', 'Day'],
  ['Indore', 'Packing Line', 'Jar Sealing', 'Day'],
  ['Indore', 'Packing Line', 'Contimix PFS', 'Night'],
  ['Indore', 'Packing Line', 'Contimix FFS', 'Night'],
  ['Indore', 'Packing Line', 'Roboarm Airlines', 'Night'],
  ['Indore', 'Packing Line', 'PFS3', 'Night'],
  ['Indore', 'Packing Line', 'LD Pack of 2', 'Night'],
  ['Indore', 'Packing Line', 'LD Pack of 4', 'Night'],
  ['Indore', 'Packing Line', 'Jar Sealing', 'Night'],
  ['Purnia', 'Packing Line', 'Can Seaming 5 (Bubber 3)', 'Day'],
  ['Purnia', 'Packing Line', 'Can Seaming 1 (Ashoka 1)', 'Night'],
  ['Purnia', 'Packing Line', 'Can Seaming 2 (Ashoka 2)', 'Night'],
  ['Purnia', 'Packing Line', 'Can Seaming 3 (Bubber 1)', 'Night'],
  ['Purnia', 'Packing Line', 'Can Seaming 4 (Bubber 2)', 'Night'],
  ['Purnia', 'Packing Line', 'Can Seaming 5 (Bubber 3)', 'Night'],
  ['Purnia', 'Packing Line', 'FFS 1 (RnF FFS)', 'Night'],
  ['Purnia', 'Packing Line', 'FFS 2 (Prasadam FFS)', 'Night'],
  ['Purnia', 'Roasting Line', 'Roasting and Flavouring Machine (Old)', 'Night'],
  ['Purnia', 'Roasting Line', 'Roasting and Flavouring Machine-Fabcon (New)', 'Night'],
]

const notPlannedSet = new Set(
  notPlannedRows.map((r) => r.map(normalize).join('|')),
)

export function defaultMachineStatus(plantName, lineName, machineName, shift) {
  const key = [plantName, lineName, machineName, shift].map(normalize).join('|')
  return notPlannedSet.has(key) ? MACHINE_STATUS_NOT_PLANNED : MACHINE_STATUS_RUNNING
}
