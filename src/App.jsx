import { useEffect, useMemo, useState } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'
import {
  DEFAULT_PRODUCTS, WAREHOUSES, calculateActual, createProductsFromStocks, displayUnit,
  exportCSV, findProductForStock, formatQty, getDiffStatus, parseStockFile
} from './utils'

const tg = window.Telegram?.WebApp
const LS_PRODUCTS = 'prime_inventory_products_v04'
const LS_STOCKS = 'prime_inventory_stocks_v04'
const LS_WAREHOUSE = 'prime_inventory_warehouse_v04'

export default function App() {
  const [screen, setScreen] = useState('home')
  const [products, setProducts] = useState([])
  const [stocks, setStocks] = useState([])
  const [warehouse, setWarehouse] = useState('Бар')
  const [query, setQuery] = useState('')
  const [selectedStock, setSelectedStock] = useState(null)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [mode, setMode] = useState('ml')
  const [value, setValue] = useState('')
  const [scanPurpose, setScanPurpose] = useState('count')
  const [toast, setToast] = useState('')

  useEffect(() => {
    tg?.ready(); tg?.expand();
    setProducts(JSON.parse(localStorage.getItem(LS_PRODUCTS) || 'null') || DEFAULT_PRODUCTS)
    setStocks(JSON.parse(localStorage.getItem(LS_STOCKS) || '[]'))
    setWarehouse(localStorage.getItem(LS_WAREHOUSE) || 'Бар')
  }, [])
  useEffect(() => localStorage.setItem(LS_PRODUCTS, JSON.stringify(products)), [products])
  useEffect(() => localStorage.setItem(LS_STOCKS, JSON.stringify(stocks)), [stocks])
  useEffect(() => localStorage.setItem(LS_WAREHOUSE, warehouse), [warehouse])

  const warehouses = useMemo(() => [...new Set([...WAREHOUSES, ...stocks.map(s => s.warehouse)])], [stocks])
  const currentStocks = useMemo(() => stocks
    .filter(s => s.warehouse === warehouse)
    .filter(s => `${s.name} ${s.group} ${s.category} ${s.article}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a,b) => Number(a.counted) - Number(b.counted) || Math.abs(b.systemQty) - Math.abs(a.systemQty)), [stocks, warehouse, query])
  const rowsWithDiff = useMemo(() => stocks.map(s => ({ ...s, status: getDiffStatus(s.difference || 0, s.systemQty || 0) })), [stocks])
  const activeDiffs = rowsWithDiff.filter(r => r.counted && r.difference !== 0)
  const notCounted = stocks.filter(s => !s.counted)
  const counted = stocks.filter(s => s.counted)
  const sumDiff = activeDiffs.reduce((sum, r) => sum + (r.difference || 0) * (r.costPerBase || 0), 0)

  function notify(text) { setToast(text); setTimeout(() => setToast(''), 2200) }

  async function importFile(file) {
    try {
      const parsed = await parseStockFile(file)
      setStocks(parsed)
      setProducts(prev => createProductsFromStocks(parsed, prev))
      if (parsed[0]?.warehouse) setWarehouse(parsed[0].warehouse)
      notify(`Загружено позиций: ${parsed.length}`)
      setScreen('inventory')
    } catch (e) {
      console.error(e)
      alert('Не удалось прочитать файл. Проверь формат XLSX/CSV.')
    }
  }

  function openStock(stock) {
    const product = findProductForStock(stock, products)
    setSelectedStock(stock)
    setSelectedProduct(product || null)
    const firstMode = product?.allowedModes?.[0] || (stock.unit === 'pcs' ? 'pcs' : stock.unit === 'g' ? 'g' : 'ml')
    setMode(firstMode)
    setValue('')
    setScreen('count')
  }

  function onBarcode(code) {
    const product = products.find(p => p.barcode === code || (p.aliases || []).includes(code))
    if (!product) { notify('Товар не найден в базе'); setScreen('inventory'); return }
    const stock = stocks.find(s => s.warehouse === warehouse && (s.article === code || s.name.toLowerCase() === product.name.toLowerCase())) ||
      stocks.find(s => s.warehouse === warehouse && s.name.toLowerCase().includes(product.name.toLowerCase().slice(0, 6)))
    if (!stock) { notify('Товар найден, но его нет на этом складе'); setScreen('inventory'); return }
    openStock(stock)
  }

  function saveCount(quickValue = null, quickMode = null) {
    if (!selectedStock) return
    const usedMode = quickMode || mode
    const usedValue = quickValue ?? value
    const product = selectedProduct || findProductForStock(selectedStock, products)
    const actualQty = calculateActual(product || { unit: selectedStock.unit, volume: 1 }, usedMode, usedValue)
    const difference = actualQty - selectedStock.systemQty
    setStocks(prev => prev.map(s => s.id === selectedStock.id ? { ...s, counted: true, actualQty, difference, inputMode: usedMode, inputValue: usedValue } : s))
    notify('Сохранено')
    const next = currentStocks.find(s => !s.counted && s.id !== selectedStock.id)
    if (next) setTimeout(() => openStock(next), 150)
    else setScreen('deviations')
  }

  function quickPercent(pct) {
    if (!selectedStock) return
    const product = selectedProduct || findProductForStock(selectedStock, products)
    const volume = Number(product?.volume || 1000)
    saveCount(Math.round(volume * pct), 'ml')
  }

  function clearAll() {
    if (!confirm('Очистить остатки и инвентаризацию?')) return
    setStocks([])
    notify('Очищено')
  }

  function sendToTelegram() {
    if (!tg) { alert('Открой WebApp внутри Telegram'); return }
    tg.sendData(JSON.stringify(rowsWithDiff))
  }

  return <div className="app">
    {toast && <div className="toast">{toast}</div>}

    {screen === 'home' && <>
      <Header />
      <section className="hero" onClick={() => setScreen(stocks.length ? 'inventory' : 'import')}>
        <div><h2>{stocks.length ? 'Продолжить инвентаризацию' : 'Загрузить остатки'}</h2><p>{stocks.length ? `${counted.length}/${stocks.length} позиций посчитано` : 'XLSX/CSV из iiko или таблицы'}</p></div><button>→</button>
      </section>
      <div className="grid">
        <Card title="Инвентаризация" text="Склады и подсчёт" onClick={() => setScreen('inventory')} />
        <Card title="Отклонения" text={`${activeDiffs.length} позиций`} onClick={() => setScreen('deviations')} />
        <Card title="Не посчитано" text={`${notCounted.length} позиций`} onClick={() => setScreen('uncounted')} />
        <Card title="Товары" text={`${products.length} в базе`} onClick={() => setScreen('products')} />
      </div>
      <Stats counted={counted.length} total={stocks.length} sumDiff={sumDiff} />
    </>}

    {screen === 'import' && <>
      <Top title="Загрузка остатков" back={() => setScreen('home')} />
      <label className="upload">
        <input type="file" accept=".xlsx,.xls,.csv" onChange={e => e.target.files?.[0] && importFile(e.target.files[0])} />
        <b>Выбрать файл остатков</b><span>XLSX / XLS / CSV</span>
      </label>
      <div className="hint"><b>Как работает:</b><p>Приложение ищет строки “Склад: ...”, товары, единицы, количество и себестоимость. Литры переводит в миллилитры, килограммы — в граммы, отрицательные остатки делает положительными.</p></div>
    </>}

    {screen === 'inventory' && <>
      <Top title="Инвентаризация" back={() => setScreen('home')} right={<button className="mini" onClick={() => setScreen('import')}>Импорт</button>} />
      <WarehouseTabs items={warehouses} value={warehouse} setValue={setWarehouse} />
      <div className="actions"><button onClick={() => { setScanPurpose('count'); setScreen('scan') }}>Сканировать</button><button onClick={() => { const n = currentStocks.find(s => !s.counted); n ? openStock(n) : notify('Всё посчитано') }}>Следующий</button></div>
      <input className="input" placeholder="Поиск товара" value={query} onChange={e => setQuery(e.target.value)} />
      <Progress counted={currentStocks.filter(s=>s.counted).length} total={currentStocks.length} />
      <div className="list">{currentStocks.map(s => <StockItem key={s.id} stock={s} onClick={() => openStock(s)} />)}</div>
    </>}

    {screen === 'count' && selectedStock && <>
      <Top title="Подсчёт" back={() => setScreen('inventory')} />
      <div className="productCard"><div className="bigEmoji">{selectedProduct?.photo || '📦'}</div><h2>{selectedStock.name}</h2><p>{selectedStock.warehouse} · {selectedStock.group || selectedStock.category}</p></div>
      <div className="compare">
        <div><span>Система</span><b>{formatQty(selectedStock.systemQty, selectedStock.unit)}</b></div>
        <div><span>Факт</span><b>{formatQty(calculateActual(selectedProduct || { unit:selectedStock.unit, volume:1 }, mode, value), selectedStock.unit)}</b></div>
      </div>
      <ModeSelector product={selectedProduct} stock={selectedStock} mode={mode} setMode={setMode} />
      {selectedStock.unit === 'ml' && <div className="quick"><button onClick={()=>quickPercent(.25)}>25%</button><button onClick={()=>quickPercent(.5)}>50%</button><button onClick={()=>quickPercent(.75)}>75%</button><button onClick={()=>quickPercent(1)}>Full</button></div>}
      <div className="form"><label>{mode === 'weight' ? 'Вес брутто, г' : mode === 'pcs' ? 'Количество, шт' : mode === 'g' ? 'Вес, кг' : 'Миллилитры'}</label><input className="input" type="number" autoFocus value={value} onChange={e=>setValue(e.target.value)} placeholder="Введите значение" />{mode === 'weight' && <p>Тара: {selectedProduct?.emptyWeight || 0} г · Плотность: {selectedProduct?.density || 1}</p>}</div>
      <DeviationPreview stock={selectedStock} actual={calculateActual(selectedProduct || { unit:selectedStock.unit, volume:1 }, mode, value)} />
      <button className="primary" onClick={() => saveCount()}>Сохранить и следующий</button>
    </>}

    {screen === 'scan' && <><Top title="Сканер" back={() => setScreen('inventory')} /><Scanner onResult={onBarcode} /></>}

    {screen === 'deviations' && <>
      <Top title="Отклонения" back={() => setScreen('home')} right={<button className="mini" onClick={() => exportCSV(rowsWithDiff, 'deviations')}>CSV</button>} />
      <Stats counted={counted.length} total={stocks.length} sumDiff={sumDiff} />
      <div className="list">{rowsWithDiff.filter(r=>r.counted).sort((a,b)=>Math.abs(b.difference)-Math.abs(a.difference)).map(r => <DiffItem key={r.id} row={r} onClick={()=>openStock(r)} />)}</div>
    </>}

    {screen === 'uncounted' && <>
      <Top title="Не посчитано" back={() => setScreen('home')} />
      <div className="list">{notCounted.map(s => <StockItem key={s.id} stock={s} onClick={() => openStock(s)} />)}</div>
    </>}

    {screen === 'products' && <>
      <Top title="База товаров" back={() => setScreen('home')} />
      <input className="input" placeholder="Поиск" value={query} onChange={e=>setQuery(e.target.value)} />
      <div className="list">{products.filter(p=>`${p.name} ${p.category} ${p.barcode}`.toLowerCase().includes(query.toLowerCase())).map(p => <div className="item" key={p.id}><div className="emoji">{p.photo}</div><div><b>{p.name}</b><p>{p.category} · режимы: {p.allowedModes.join(', ')}</p></div></div>)}</div>
    </>}

    {screen === 'settings' && <>
      <Top title="Настройки" back={() => setScreen('home')} />
      <button className="primary" onClick={() => exportCSV(rowsWithDiff, 'inventory')}>Экспорт CSV</button>
      <button className="primary" onClick={sendToTelegram}>Отправить в Telegram</button>
      <button className="danger" onClick={clearAll}>Очистить остатки</button>
    </>}

    <nav><button onClick={()=>setScreen('home')}>Главная</button><button onClick={()=>setScreen('inventory')}>Инвент</button><button onClick={()=>setScreen('deviations')}>Отклонения</button><button onClick={()=>setScreen('settings')}>Ещё</button></nav>
  </div>
}

function Header(){return <header><div className="logo">🍾</div><div><h1>Prime Inventory</h1><p>Telegram WebApp для инвентаризации</p></div></header>}
function Top({title,back,right}){return <div className="top"><button onClick={back}>←</button><h2>{title}</h2><span>{right}</span></div>}
function Card({title,text,onClick}){return <div className="card" onClick={onClick}><b>{title}</b><p>{text}</p></div>}
function Stats({counted,total,sumDiff}){return <div className="stats"><div><span>Посчитано</span><b>{counted}/{total}</b></div><div><span>Осталось</span><b>{Math.max(total-counted,0)}</b></div><div><span>Разница</span><b>{Math.round(sumDiff).toLocaleString('ru-RU')} ₽</b></div></div>}
function Progress({counted,total}){const pct=total?Math.round(counted/total*100):0; return <div className="progress"><div><span style={{width:`${pct}%`}} /></div><p>{pct}% · {counted}/{total}</p></div>}
function WarehouseTabs({items,value,setValue}){return <div className="tabs">{items.map(w=><button key={w} className={w===value?'active':''} onClick={()=>setValue(w)}>{w}</button>)}</div>}
function StockItem({stock,onClick}){return <div className={`item ${stock.counted?'done':''}`} onClick={onClick}><div><b>{stock.name}</b><p>{stock.group || stock.category} · система: {formatQty(stock.systemQty, stock.unit)}</p></div><span>{stock.counted?'✓':'→'}</span></div>}
function DiffItem({row,onClick}){return <div className={`item diff ${row.status}`} onClick={onClick}><div><b>{row.name}</b><p>{row.warehouse} · система {formatQty(row.systemQty,row.unit)} · факт {formatQty(row.actualQty,row.unit)}</p></div><b>{row.difference>0?'+':''}{formatQty(row.difference,row.unit)}</b></div>}
function ModeSelector({product,stock,mode,setMode}){const modes=product?.allowedModes || (stock.unit==='pcs'?['pcs']:stock.unit==='g'?['g']:['ml']); const names={weight:'Вес',ml:'мл',pcs:'шт',g:'кг'}; return <div className="modes">{modes.map(m=><button key={m} className={m===mode?'active':''} onClick={()=>setMode(m)}>{names[m]||m}</button>)}</div>}
function DeviationPreview({stock,actual}){const diff=actual-stock.systemQty; const status=getDiffStatus(diff,stock.systemQty); return <div className={`result ${status}`}><span>Отклонение</span><b>{diff>0?'+':''}{formatQty(diff,stock.unit)}</b></div>}
function Scanner({onResult}){useEffect(()=>{const scanner=new Html5QrcodeScanner('reader',{fps:10,qrbox:{width:250,height:140}},false); scanner.render(t=>{scanner.clear(); onResult(t)},()=>{}); return()=>scanner.clear().catch(()=>{})},[]); return <div id="reader" className="scanner" />}
