import { useEffect, useRef, useState } from 'react'
import { clampCamera, fitSpain, fitTheatre, limits, panBy, project, THEATRE, toScreen, toWorld, visibleTiles, zoomAt } from './camera'
import type { Camera, Point, Viewport } from './camera'
import { TileCache } from './tile-cache'
import { IMAGERY_CREDIT, IMAGERY_LICENSE_URL, IMAGERY_TILE_BUDGET, loadImageryTile, releaseImageryTile } from './imagery'
import type { ImageryTile } from './imagery'
import geography from './geography.json'
import {countries,countryAt} from './countries'
import overviewUrl from './overview.jpg'
import './europe.css'
import {europeGameToDisplay,europeDisplayToGame,EUROPE_SCENARIO_VIEW} from '@strategy-game/shared-types'
import type {RepeatingCurrent,MovementRoute,PublicWorld} from '@strategy-game/shared-types'

const cities = geography.cities
const countryPaths = geography.countries.map(country => ({ name: country.name,
  path: country.polygons.map(polygon => polygon.map(ring => ring.map((p, i) => {
    const point = project(p[0]!, p[1]!)
    return `${i ? 'L' : 'M'}${point.x},${point.y}`
  }).join(' ') + ' Z').join(' ')).join(' ') }))
const startView = { width: 1920, height: 920 }

export default function EuropeMap({view:current,route,choose,world}:{view:RepeatingCurrent;route:MovementRoute|null;choose:((p:Point)=>void)|null;world:PublicWorld}) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const cameraRef = useRef<Camera>(fitTheatre(startView))
  const target = useRef<Camera>(fitTheatre(startView))
  const viewportRef = useRef<Viewport>(startView)
  const [view, setView] = useState(startView)
  const [camera, setCamera] = useState(() => fitTheatre(startView))
  const [hoverCountry,setHoverCountry]=useState<string|null>(null)
  const [countryLabels,setCountryLabels]=useState(true)
  const [selected, setSelected] = useState('Madrid')
  const [borders, setBorders] = useState(true)
  const [labels, setLabels] = useState(true)
  const [errors, setErrors] = useState(0)
  const [cached, setCached] = useState(0)
  const cacheRef = useRef<TileCache<ImageryTile<ImageBitmap>> | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null)
  const [draft,setDraft]=useState<Point[]>([])
  const [draftMode,setDraftMode]=useState(false)
  const [pickError,setPickError]=useState('')

  useEffect(() => {
    const element = host.current!
    const context = canvas.current!.getContext('2d')!
    // Cartographic display clip only. Never a movement or navigability mask.
    const landSilhouette = new Path2D(countryPaths.map(country => country.path).join(' '))
    let active = true
    let frame = 0
    let background: HTMLImageElement | null = new Image()
    background.src = overviewUrl
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
    const cache: TileCache<ImageryTile<ImageBitmap>> = new TileCache(loadImageryTile, releaseImageryTile,
      () => { if (active) { setErrors(cache.errorCount + Number(cache.some(tile => tile.degraded))); setCached(cache.size) } }, IMAGERY_TILE_BUDGET)
    cacheRef.current = cache
    let lastTime = 0
    const draw = (time: number) => {
      if (!active) return
      const v = viewportRef.current
      const current = cameraRef.current
      const next = target.current
      const alpha = reducedMotion.matches ? 1 : 1 - Math.exp(-Math.min(60, time - lastTime) / 65)
      lastTime = time
      const settled = Math.abs(next.scale - current.scale) < 0.01 && Math.hypot(next.center.x - current.center.x, next.center.y - current.center.y) < 1e-8
      if (!settled) {
        cameraRef.current = { scale: current.scale + (next.scale - current.scale) * alpha,
          center: { x: current.center.x + (next.center.x - current.center.x) * alpha, y: current.center.y + (next.center.y - current.center.y) * alpha } }
        setCamera(cameraRef.current)
      }
      const c = cameraRef.current
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const surface = canvas.current!
      if (surface.width !== Math.round(v.width * dpr) || surface.height !== Math.round(v.height * dpr)) {
        surface.width = Math.round(v.width * dpr); surface.height = Math.round(v.height * dpr)
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.fillStyle = '#102c3d'; context.fillRect(0, 0, v.width, v.height)
      const nw = toScreen(project(THEATRE.west, THEATRE.north), c, v)
      const se = toScreen(project(THEATRE.east, THEATRE.south), c, v)
      if (background?.complete && background.naturalWidth) context.drawImage(background, nw.x, nw.y, se.x - nw.x, se.y - nw.y)
      const tiles = visibleTiles(c, v, dpr, IMAGERY_TILE_BUDGET)
      cache.sync(tiles.map(tile => tile.key))
      const drawLayer = (kind: 'base' | 'regional') => {
        for (const tile of tiles) {
          let image = cache.get(tile.key)
          let level = tile.z
          while (!image && level > 0) {
            level--
            const factor = 2 ** (tile.z - level)
            image = cache.get(`${level}/${Math.floor(tile.y / factor)}/${Math.floor(tile.x / factor)}`)
          }
          const layer = image?.[kind]
          if (!layer) continue
          const p = toScreen({ x: tile.x / 2 ** tile.z, y: tile.y / 2 ** tile.z }, c, v)
          const size = c.scale / 2 ** tile.z
          const factor = 2 ** (tile.z - level)
          const sourceSize = layer.width / factor
          context.drawImage(layer, (tile.x % factor) * sourceSize, (tile.y % factor) * sourceSize, sourceSize, sourceSize, p.x, p.y, size + 0.5, size + 0.5)
        }
      }
      drawLayer('base')
      // Apply one shared clip per frame, not one expensive path clip per tile.
      context.save()
      context.setTransform(dpr * c.scale, 0, 0, dpr * c.scale,
        dpr * (v.width / 2 - c.center.x * c.scale), dpr * (v.height / 2 - c.center.y * c.scale))
      context.clip(landSilhouette)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawLayer('regional')
      context.restore()
      frame = requestAnimationFrame(draw)
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const nextView = { width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) }
      const old = viewportRef.current
      const fraction = cameraRef.current.scale / limits(old).max
      viewportRef.current = nextView
      target.current = clampCamera({ ...cameraRef.current, scale: fraction * limits(nextView).max }, nextView)
      cameraRef.current = target.current
      setView(nextView); setCamera(target.current)
    })
    observer.observe(element)
    const wheel = (event: WheelEvent) => {
      // Preserve browser accessibility zoom (Ctrl + wheel).
      if (event.ctrlKey || (event.target as Element).closest('aside')) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1)
      target.current = zoomAt(target.current, viewportRef.current,
        { x: event.clientX - rect.left, y: event.clientY - rect.top }, Math.exp(-Math.max(-250, Math.min(250, delta)) * 0.002))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    frame = requestAnimationFrame(draw)
    return () => {
      active = false; cancelAnimationFrame(frame); observer.disconnect()
      element.removeEventListener('wheel', wheel); cache.dispose(); cacheRef.current = null
      if (background) background.src = ''; background = null
    }
  }, [])

  const zoom = (factor: number) => { target.current = zoomAt(target.current, view, { x: view.width / 2, y: view.height / 2 }, factor) }
  const selectCity = (name: string) => {
    const city = cities.find(city => city.name === name)!
    setSelected(name)
    target.current = clampCamera({ ...target.current, center: project(city.lon, city.lat) }, view)
  }
  const selectedCity = cities.find(city => city.name === selected)!
  const onMap = (p: Point) => p.x >= 24 && p.x <= view.width - 24 && p.y >= 24 && p.y <= view.height - 24
  const zoomPercent = Math.round(camera.scale / limits(view).max * 100)
  const visibleLabels = new Set<string>()
  const labelBoxes: { x: number; y: number; right: number; bottom: number }[] = []
  for (const city of [...cities].sort((a, b) => Number(b.name === selected) - Number(a.name === selected) || Number(b.capital) - Number(a.capital))) {
    if (!labels || !(city.capital || camera.scale / limits(view).min > 2.1 || city.name === selected)) continue
    const p = toScreen(project(city.lon, city.lat), camera, view)
    const box = { x: p.x + 11, y: p.y - 11, right: p.x + 20 + city.name.length * 7, bottom: p.y + 9 }
    if (!onMap(p) || box.right > view.width - 8 || labelBoxes.some(b => box.x < b.right + 6 && box.right + 6 > b.x && box.y < b.bottom + 3 && box.bottom + 3 > b.y)) continue
    visibleLabels.add(city.name); labelBoxes.push(box)
  }

  const countryBoxes:{x:number;y:number;right:number;bottom:number}[]=[]
  const visibleCountries=new Set<string>()
  for(const country of [...countries].sort((a,b)=>(b.bounds.right-b.bounds.left)*(b.bounds.bottom-b.bounds.top)-(a.bounds.right-a.bounds.left)*(a.bounds.bottom-a.bounds.top))){
    const p=toScreen(country.anchor,camera,view),w=country.name.length*9+20
    if(!onMap(p)||(country.bounds.right-country.bounds.left)*camera.scale<65)continue
    const box={x:p.x-w/2,y:p.y-18,right:p.x+w/2,bottom:p.y+18}
    if(countryBoxes.some(b=>box.x<b.right&&box.right>b.x&&box.y<b.bottom&&box.bottom>b.y))continue
    countryBoxes.push(box);visibleCountries.add(country.name)
  }
  return <main className="europe-prototype">
    <header className="ep-header">
      <div className="ep-brand"><img src="/assets/branding/emblem.svg" alt="" /><span>SOVEREIGN<small>GLOBAL CROWN</small></span></div>
      <div className="ep-heading"><span className="ep-eyebrow">WORLD MAP · EUROPE</span><strong>The continental theatre</strong></div>
      <span className="ep-fixture">EUROPE PLAYTEST <small>Server-authoritative own planning</small></span>
    </header>
      <details className="ep-options"><summary>Map options · cities and layers</summary><aside className="ep-inspector" aria-label="City inspector">
        <label htmlFor="ep-country-select">Find a country</label><select id="ep-country-select" value={hoverCountry??''} onChange={event=>{const c=countries.find(c=>c.name===event.target.value);if(c){setHoverCountry(c.name);target.current=clampCamera({...target.current,center:c.anchor},view)}}}><option value="">Choose a country</option>{countries.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select>
        <span className="ep-eyebrow">DISPLAY CITY · NOT A PLAYTEST CAMP</span>
        <h1>{selectedCity.name}</h1><p>{selectedCity.country} <span>· {selectedCity.capital ? 'Capital' : 'City'}</span></p>
        <label htmlFor="ep-city-select">Find a city</label>
        <select id="ep-city-select" value={selected} onChange={event => selectCity(event.target.value)}>{cities.map(city => <option key={`${city.country}/${city.name}`} value={city.name}>{city.country} · {city.name}</option>)}</select>
        <div className="ep-rule" /><p className="ep-muted">Country outlines and display cities do not indicate ownership or territory control. Only the two scenario camps are capture objectives. Geneva is unavailable for land gameplay: its original anchor is inland water.</p>
        <div className="ep-layer-buttons"><button aria-pressed={borders} onClick={() => setBorders(!borders)}>Borders</button><button aria-pressed={labels} onClick={() => setLabels(!labels)}>City labels</button><button aria-pressed={countryLabels} onClick={()=>setCountryLabels(!countryLabels)}>Country names</button></div>
      </aside></details>
    <div className="ep-map" ref={host} tabIndex={0} role="region" aria-label="Europe map camera" aria-describedby="ep-instructions"
      onKeyDown={event => {
        if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.35) }
        else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.35) }
        else {
          const direction: Record<string, Point> = { ArrowLeft: { x: 90, y: 0 }, ArrowRight: { x: -90, y: 0 }, ArrowUp: { x: 0, y: 90 }, ArrowDown: { x: 0, y: -90 } }
          const delta = direction[event.key]
          if (delta) { event.preventDefault(); target.current = panBy(target.current, view, delta) }
        }
      }}
      onPointerDown={event => {
        if (event.button !== 0 || (event.target as Element).closest('button,select,aside,a')) return
        event.currentTarget.focus({ preventScroll: true })
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false }
      }}
      onPointerLeave={()=>setHoverCountry(null)}
      onPointerMove={event => {
        const rect=event.currentTarget.getBoundingClientRect()
        if (!(event.target as Element).closest('button,select,aside,a,details')) setHoverCountry(countryAt(toWorld({x:event.clientX-rect.left,y:event.clientY-rect.top},cameraRef.current,viewportRef.current)))
        const previous = drag.current
        if (!previous || previous.id !== event.pointerId) return
        if (!previous.moved && Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY) < 4) return
        const next = panBy(target.current, view, { x: event.clientX - previous.x, y: event.clientY - previous.y })
        // Drag follows the pointer directly; wheel/buttons ease between positions.
        target.current = next; cameraRef.current = next; setCamera(next)
        drag.current = { ...previous, x: event.clientX, y: event.clientY, moved: true }
      }} onPointerUp={event => {
        const previous = drag.current
        drag.current = null
        if (previous?.id === event.pointerId && !previous.moved) {
          const rect = event.currentTarget.getBoundingClientRect()
          const p=toWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, cameraRef.current, viewportRef.current)
          if(draftMode){setDraft(points=>points.length<32?[...points,p]:points);return}
          if(choose)try{choose(europeDisplayToGame(p));setPickError('')}catch{setPickError('Choose a destination inside the outlined playtest area. No order was submitted.')}
        }
      }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
      <canvas ref={canvas} className="ep-terrain" aria-hidden="true" />
      <svg className="ep-borders" width={view.width} height={view.height} aria-hidden="true">
        {borders && <g transform={`translate(${view.width / 2 - camera.center.x * camera.scale},${view.height / 2 - camera.center.y * camera.scale}) scale(${camera.scale})`}>
          {countryPaths.map(country => <path key={country.name} d={country.path} fill="none" stroke={country.name === selectedCity.country ? '#f5d66d' : '#d9dfda'} strokeWidth={country.name === selectedCity.country ? 2 : 0.8} vectorEffect="non-scaling-stroke" opacity={country.name === selectedCity.country ? 1 : 0.6} />)}
        </g>}
      </svg>
      <div className="ep-markers" aria-hidden="true">
        {cities.map(city => {
          const p = toScreen(project(city.lon, city.lat), camera, view)
          if (!onMap(p)) return null
          const chosen = city.name === selected
          const show = visibleLabels.has(city.name)
          return <button key={`${city.country}/${city.name}`} tabIndex={-1} aria-hidden="true" className={`ep-city ${city.capital ? 'capital' : ''} ${chosen ? 'selected' : ''}`} style={{ left: p.x, top: p.y }} onClick={() => setSelected(city.name)} title={`${city.name}, ${city.country}${city.capital ? ' · Capital' : ''}`}>
            <span className="ep-dot">{city.capital ? '◆' : '●'}</span>{show && <span className="ep-city-name">{city.name}</span>}
          </button>
        })}
      </div>
      <div className="ep-country-labels" aria-hidden="true">{countryLabels&&countries.map(country=>{const p=toScreen(country.anchor,camera,view);return visibleCountries.has(country.name)?<span key={country.name} className="ep-country-name" style={{left:p.x,top:p.y}}>{country.name}</span>:null})}</div>
      {hoverCountry&&<output className="ep-country-tooltip" aria-live="polite">{hoverCountry} · geographic border</output>}

      <svg className="ep-borders" width={view.width} height={view.height} aria-hidden="true">
        {(()=>{const a=toScreen(europeGameToDisplay({x:0,y:0}),camera,view),b=toScreen(europeGameToDisplay({x:1000,y:500}),camera,view);return <rect x={a.x} y={a.y} width={b.x-a.x} height={b.y-a.y} fill="none" stroke="#f5d66d" strokeDasharray="6 5"/>})()}
        {route?.segments.map(segment=>{const a=toScreen(europeGameToDisplay(segment.from),camera,view),b=toScreen(europeGameToDisplay(segment.destination),camera,view);return <line key={segment.orderId} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f5d66d" strokeWidth={3} strokeDasharray="5 5"/>})}
        <polyline points={draft.map(p=>{const q=toScreen(p,camera,view);return `${q.x},${q.y}`}).join(' ')} fill="none" stroke="#a6b3c3" strokeWidth={3} strokeDasharray="3 6"/>
      </svg>
      <div className="ep-markers">
       {current.formations.map(f=>{const p=toScreen(europeGameToDisplay(f.position),camera,view);return <span key={f.formationId} style={{position:'absolute',left:p.x,top:p.y,color:'#fff',background:'#142c42',padding:8,transform:'translate(-50%,-50%)'}} title={`Own formation ${f.formationId}`}>▲ Own</span>})}
       {world.territories.filter(t=>t.city).map(t=>{const p=toScreen(europeGameToDisplay(t.center),camera,view),own=current.ownedLocationIds.includes(t.city!.cityId);return <span key={t.city!.cityId} style={{position:'absolute',left:p.x,top:p.y+25,color:own?'#f5d66d':'#ddd',background:'#142c42',padding:4}}>Camp {t.center.x<500?'West':'East'} · {own?'currently yours':'current owner undisclosed'}</span>})}
      </div>

      <div className="ep-camera-tools" aria-label="Map camera controls">
        <button onClick={() => { target.current = fitTheatre(view) }}>Europe overview</button>
        <button onClick={()=>{target.current=clampCamera({...fitSpain(view),center:europeGameToDisplay({x:500,y:250})},view)}}>Playtest area</button>
        <details className="ep-extra-tools"><summary>More map tools</summary><button aria-pressed={draftMode} onClick={()=>setDraftMode(v=>!v)}>Uncommitted defense drawing</button>
        <button onClick={()=>setDraft([])}>Clear drawing</button>
        <button onClick={() => { target.current = fitSpain(view) }}>Spain · maximum zoom</button></details>
        <div><button aria-label="Zoom out" onClick={() => zoom(1 / 1.35)}>−</button><output aria-live="off" aria-label="Zoom relative to maximum">{zoomPercent}%</output><button aria-label="Zoom in" onClick={() => zoom(1.35)}>+</button></div>
      </div>
      <a className="ep-attribution" href={IMAGERY_LICENSE_URL} target="_blank" rel="noreferrer">{IMAGERY_CREDIT}</a>
      {pickError&&<div className="ep-tile-error" role="alert">{pickError}</div>}
      {errors > 0 && <div className="ep-tile-error" role="status">Some satellite detail is unavailable. Available imagery and the overview remain visible. <button onClick={() => cacheRef.current?.retry(tile => tile.degraded)}>Retry imagery</button></div>}
    </div>
    <details className="ep-help"><summary>Map help and playtest limits</summary><p>Defense drawings are local uncommitted drafts: no surface approval, assignment, control or combat effect. Click destinations only after selecting an own formation; map clicks fill the coordinate fields and never submit. Current own markers and camp ownership come from the server; background cities and borders are context. Projection {EUROPE_SCENARIO_VIEW.projectionId}.</p></details>
    <footer className="ep-footer"><span id="ep-instructions">Drag to pan · Scroll or + / − to zoom · Focus map and use arrows to pan · Find cities with the selector</span><span>{cached}/{IMAGERY_TILE_BUDGET} tiles cached · Sentinel-2 regional detail · Spain-wide zoom cap</span></footer>
  </main>
}
