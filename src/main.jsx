import React from 'react'
import ReactDOM from 'react-dom/client'

function App() {
  return (
    <div style={{
      fontFamily: 'Inter, sans-serif',
      padding: 24,
      background:'#f4f7fb',
      minHeight:'100vh'
    }}>
      <h1>Prime Inventory v0.4</h1>
      <p>Telegram WebApp для инвентаризации бара.</p>

      <ul>
        <li>Импорт XLSX/CSV</li>
        <li>Склады</li>
        <li>Отклонения</li>
        <li>Сканирование штрихкодов</li>
        <li>Экспорт CSV</li>
      </ul>

      <div style={{
        marginTop:20,
        padding:20,
        borderRadius:16,
        background:'white'
      }}>
        Проект готов для GitHub Pages.
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)