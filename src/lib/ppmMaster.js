const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^purnea$/, 'purnia')

const ppmRows = [
  ['Indore', 'Packing Line', 'Conti Mix', 12],
  ['Indore', 'Packing Line', 'FlowWrap', 210],
  ['Indore', 'Packing Line', 'Jar Sealing', 5],
  ['Indore', 'Packing Line', 'Jar Sealing - WAD Machine', 5],
  ['Indore', 'Packing Line', 'LD Pack of 2', 5],
  ['Indore', 'Packing Line', 'LD Pack of 4', 3],
  ['Indore', 'Packing Line', 'Pace - FFS', 62],
  ['Indore', 'Packing Line', 'Perfect - FFS', 35],
  ['Indore', 'Packing Line', 'Table', 5],
  ['Indore', 'Packing Line', 'Table - Airlines', 33],
  ['Indore', 'Packing Line', 'PFS1', 22],
  ['Indore', 'Packing Line', 'PFS2', 22],
  ['Indore', 'Packing Line', 'PFS3', 19],
  ['Indore', 'Packing Line', 'Contimix PFS', 29],
  ['Indore', 'Packing Line', 'Contimix FFS', 12],
  ['Indore', 'Packing Line', 'Roboarm Airlines', 50],
  ['Indore', 'Roasting Line', 'Oven1', 3],
  ['Indore', 'Roasting Line', 'Oven2', 3],
  ['Indore', 'Mixing Line', 'Mixing Line 1', 4],
  ['Kundli', 'Packing Line', 'FlowWrap Machine 1', 150],
  ['Kundli', 'Packing Line', 'FlowWrap Machine 2', 150],
  ['Kundli', 'Packing Line', 'FlowWrap Machine 3', 150],
  ['Kundli', 'Packing Line', 'FlowWrap Machine 4', 150],
  ['Kundli', 'Packing Line', 'Tin Seaming', 25],
  ['Kundli', 'Packing Line', 'Srp Machine', 25],
  ['Kundli', 'Roasting Line', 'Roasting', 4],
  ['Kundli', 'Mixing Line', 'kadhai 1', 17],
  ['Kundli', 'Mixing Line', 'kadhai 2', 17],
  ['Kundli', 'Mixing Line', 'kadhai 3', 17],
  ['Kundli', 'Mixing Line', 'kadhai 4', 17],
  ['Kundli', 'Mixing Line', 'kadhai 5', 17],
  ['Purnia', 'Packing Line', 'Can Seaming 1 (Ashoka 1)', 36],
  ['Purnia', 'Packing Line', 'Can Seaming 2 (Ashoka 2)', 36],
  ['Purnia', 'Packing Line', 'Can Seaming 3 (Bubber 1)', 12],
  ['Purnia', 'Packing Line', 'Can Seaming 4 (Bubber 2)', 12],
  ['Purnia', 'Packing Line', 'Can Seaming 5 (Bubber 3)', 7],
  ['Purnia', 'Packing Line', 'Can Seaming 6 (Ashoka 3)', 36],
  ['Purnia', 'Packing Line', 'Can Seaming 7 (Ashoka 4)', 36],
  ['Purnia', 'Packing Line', 'FFS 1 (RnF FFS)', 40],
  ['Purnia', 'Packing Line', 'FFS 2 (Prasadam FFS)', 23],
  ['Purnia', 'Packing Line', 'RnF FFS - Pace', 80],
  ['Purnia', 'Roasting Line', 'Roasting and Flavouring Machine (Old)', 2],
  ['Purnia', 'Roasting Line', 'Roasting and Flavouring Machine-Fabcon (New)', 4],
]

const ppmByMachine = new Map(
  ppmRows.map(([plant, line, machine, ppm]) => [
    [plant, line, machine].map(normalize).join('|'),
    ppm,
  ]),
)

export function getMasterPpm(plantName, lineName, machineName) {
  return ppmByMachine.get([plantName, lineName, machineName].map(normalize).join('|')) ?? ''
}
