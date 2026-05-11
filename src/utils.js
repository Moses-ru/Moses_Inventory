import * as XLSX from 'xlsx'

export const WAREHOUSES = ['Бар', 'Бэк', 'Холодильник', 'Морозилка', 'Склад']

export const DEFAULT_PRODUCTS = [
  { id: 'beefeater', barcode: '5000329002193', name: 'Beefeater Gin', group: 'Джин', category: 'Алкоголь', unit: 'ml', volume: 1000, density: 0.94, emptyWeight: 420, costPerBase: 1.25, allowedModes: ['weight', 'ml'], photo: '🍸' },
  { id: 'jameson', barcode: '5011007003005', name: 'Jameson 0.7', group: 'Виски', category: 'Алкоголь', unit: 'ml', volume: 700, density: 0.94, emptyWeight: 410, costPerBase: 3.2, allowedModes: ['weight', 'ml'], photo: '🥃' },
  { id: 'prosecco', barcode: '2000000000777', name: 'Prosecco 0.75', group: 'Вино', category: 'Вино', unit: 'ml', volume: 750, density: 0.99, emptyWeight: 500, costPerBase: 1.1, allowedModes: ['ml', 'pcs'], photo: '🍾' },
  { id: 'pnd-mango', barcode: '45700026475', name: 'Пюре Pinch&Drop Манго', group: 'Сиропы кофе', category: 'Сиропы / Пюре', unit: 'ml', volume: 1000, density: 1.18, emptyWeight: 250, costPerBase: 0.97, allowedModes: ['weight', 'ml'], photo: '🥭' },
]

export function normalizeName(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[ё]/g, 'е')
    .replace(/[’'`.,()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function cleanWarehouseName(raw = '') {
  const text = String(raw).replace(/склад:/i, '').trim()
  if (/бар/i.test(text)) return 'Бар'
  if (/бэк|back/i.test(text)) return 'Бэк'
  if (/холод/i.test(text)) return 'Холодильник'
  if (/мороз/i.test(text)) return 'Морозилка'
  if (/склад/i.test(text)) return 'Склад'
  return text || 'Склад'
}

export function normalizeUnit(unit = '') {
  const u = String(unit).toLowerCase().trim()
  if (u === 'л' || u === 'литр' || u === 'литры') return 'ml'
  if (u === 'кг' || u === 'килограмм') return 'g'
  if (u === 'шт' || u === 'pcs') return 'pcs'
  if (u === 'мл') return 'ml'
  if (u === 'г') return 'g'
  return u || 'pcs'
}

export function convertSystemQty(qty, unit) {
  const n = Math.abs(Number(qty) || 0)
  const u = normalizeUnit(unit)
  if (u === 'ml') return Math.round(n * 1000)
  if (u === 'g') return Math.round(n * 1000)
  return Number(n.toFixed(3))
}

export function displayUnit(unit) {
  if (unit === 'ml') return 'мл'
  if (unit === 'g') return 'г'
  return 'шт'
}

export function suggestProductType(group = '', category = '', unit = '') {
  const text = normalizeName(`${group} ${category}`)
  if (/виски|ром|джин|водк|текил|ликер|коньяк|бренди|вермут|алкоголь|самбука|абсент/.test(text)) return { unit: 'ml', allowedModes: ['weight', 'ml'], photo: '🥃' }
  if (/вино|игрист|шампан|просекко/.test(text)) return { unit: 'ml', allowedModes: ['ml', 'pcs'], photo: '🍾' }
  if (/сироп|пюре/.test(text)) return { unit: 'ml', allowedModes: ['weight', 'ml'], photo: '🧃' }
  if (/фрукт|овощ|зелень|молоко|бакалея/.test(text) || normalizeUnit(unit) === 'g') return { unit: 'g', allowedModes: ['g'], photo: '🥬' }
  if (normalizeUnit(unit) === 'pcs') return { unit: 'pcs', allowedModes: ['pcs'], photo: '📦' }
  return { unit: normalizeUnit(unit), allowedModes: [normalizeUnit(unit)], photo: '📦' }
}

export function calculateActual(product, mode, value) {
  const v = Number(value) || 0
  if (!product) return 0
  if (mode === 'weight') {
    const net = v - (Number(product.emptyWeight) || 0)
    if (net <= 0) return 0
    return Math.round(net / (Number(product.density) || 1))
  }
  if (mode === 'pcs') return Math.round(v * (Number(product.volume) || 1))
  if (mode === 'g') return Math.round(v * 1000)
  return Math.round(v)
}

export function getDiffStatus(diff, systemQty) {
  const abs = Math.abs(diff)
  const base = Math.max(Math.abs(systemQty), 1)
  const pct = abs / base
  if (abs === 0) return 'ok'
  if (pct <= 0.05) return 'warn'
  return diff < 0 ? 'bad' : 'extra'
}

export function formatQty(qty, unit) {
  const n = Number(qty || 0)
  if (unit === 'pcs') return `${Number(n.toFixed(3))} шт`
  return `${Math.round(n).toLocaleString('ru-RU')} ${displayUnit(unit)}`
}

export async function parseStockFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const result = []
  let warehouse = 'Склад'
  for (const row of rows) {
    const first = String(row[0] || '').trim()
    if (/^склад:/i.test(first)) {
      warehouse = cleanWarehouseName(first)
      continue
    }
    const name = String(row[3] || '').trim()
    const unitRaw = String(row[5] || '').trim()
    const qty = row[9]
    if (!name || name === 'Наименование' || !unitRaw) continue
    const group = String(row[1] || '').trim()
    const category = String(row[4] || '').trim()
    const unit = normalizeUnit(unitRaw)
    const baseQty = convertSystemQty(qty, unitRaw)
    const costPerBase = unit === 'pcs' ? Math.abs(Number(row[8]) || 0) : Math.abs(Number(row[8]) || 0) / 1000
    result.push({
      id: crypto.randomUUID(),
      warehouse,
      group,
      article: String(row[2] || '').trim(),
      name,
      category,
      sourceUnit: unitRaw,
      unit,
      systemQty: baseQty,
      cost: Math.abs(Number(row[6]) || 0),
      costPerBase,
      rawQty: Number(qty) || 0,
      counted: false,
      actualQty: 0,
      difference: -baseQty,
    })
  }
  return result
}

export function createProductsFromStocks(stocks, existing = []) {
  const map = new Map(existing.map(p => [normalizeName(p.name), p]))
  for (const s of stocks) {
    const key = normalizeName(s.name)
    if (map.has(key)) continue
    const suggested = suggestProductType(s.group, s.category, s.sourceUnit)
    map.set(key, {
      id: crypto.randomUUID(),
      barcode: s.article || '',
      name: s.name,
      group: s.group,
      category: s.category || suggested.unit,
      unit: suggested.unit,
      volume: suggested.unit === 'ml' ? 1000 : 1,
      density: suggested.unit === 'ml' ? 0.95 : 1,
      emptyWeight: 0,
      costPerBase: s.costPerBase || 0,
      allowedModes: suggested.allowedModes,
      photo: suggested.photo,
      aliases: [s.article].filter(Boolean),
    })
  }
  return [...map.values()]
}

export function findProductForStock(stock, products) {
  const name = normalizeName(stock.name)
  return products.find(p => normalizeName(p.name) === name || p.barcode === stock.article || (p.aliases || []).includes(stock.article))
}

export function exportCSV(rows, name = 'inventory') {
  const headers = ['Склад','Товар','Категория','Система','Факт','Ед','Отклонение','Статус','Сумма отклонения']
  const csv = [headers.join(';'), ...rows.map(r => [r.warehouse,r.name,r.category,r.systemQty,r.actualQty,r.unit,r.difference,r.status,Math.round((r.difference || 0) * (r.costPerBase || 0))].join(';'))].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
