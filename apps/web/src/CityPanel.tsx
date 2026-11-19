import { useId, useState } from 'react'
import type { CityBalance, CityEdit, CityPlan, CityProjection } from '@strategy-game/shared-types'

type GarrisonUnit = {
  unitId: string
  kind: 'INFANTRY' | 'LEADER'
  hp: number
  maxHp: number
}
type Props = {
  city: CityProjection
  cities: readonly CityProjection[]
  balance: CityBalance
  own: CityPlan
  units: readonly GarrisonUnit[]
  editable: boolean
  edit: (command: CityEdit) => void
  selectDispatch: (unitIds: readonly string[]) => void
}

export default function CityPanel(props: Props) {
  return <CityControls key={props.city.cityId} {...props} />
}

function CityControls({ city, cities, balance, own, units, editable, edit, selectDispatch }: Props) {
  const title = useId()
  const [type, setType] = useState<'INFANTRY' | 'LIEUTENANT'>('INFANTRY')
  const [quantity, setQuantity] = useState('1')
  const [selected, setSelected] = useState<string[]>([])
  const reserved = new Set(own.dispatches.flatMap(d => d.unitIds))
  const available = city.owned ? units.filter(u => !reserved.has(u.unitId)) : []
  const selectedUnits = available.filter(u => selected.includes(u.unitId))
  const remaining = balance.capacity - own.recruitment.filter(r => r.cityId === city.cityId)
    .reduce((sum, r) => sum + r.quantity, 0)
  const count = Number(quantity)
  const price = count * (type === 'INFANTRY' ? balance.infantryPrice : balance.lieutenantPrice)
  const validCount = Number.isInteger(count) && count > 0 && count <= remaining
  const canRecruit = editable && city.owned && validCount && price <= own.credits
  const cityName = (id: string) => cities.find(c => c.cityId === id)?.name ?? id
  return <section aria-labelledby={title} className="city-panel">
    <h3 id={title}>{city.name}{city.capital ? ' · Capital' : ''}</h3>
    <p>Your treasury: <strong>{own.credits.toLocaleString()} credits</strong></p>
    {city.owned ? <>
      <fieldset disabled={!editable}>
        <legend>Recruit troops</legend>
        <p>{remaining} of {balance.capacity} recruitment slots available this turn.</p>
        <label>Unit<select value={type} onChange={e => setType(e.target.value === 'LIEUTENANT' ? 'LIEUTENANT' : 'INFANTRY')}>
          <option value="INFANTRY">Infantry · {balance.infantryPrice} credits</option>
          <option value="LIEUTENANT">Lieutenant · {balance.lieutenantPrice} credits</option>
        </select></label>
        <label>Quantity<input type="number" min={1} max={Math.max(1, remaining)} step={1}
          value={quantity} onChange={e => setQuantity(e.target.value)} /></label>
        <p>Total price: {validCount ? `${price.toLocaleString()} credits` : 'Enter a valid quantity'}</p>
        <button disabled={!canRecruit} onClick={() => edit({ kind: 'recruit', cityId: city.cityId,
          recruitmentId: crypto.randomUUID(), unitType: type, quantity: count })}>Queue recruitment</button>
      </fieldset>
      <fieldset disabled={!editable}>
        <legend>Garrison</legend>
        {units.length === 0 && <p>No units stationed here.</p>}
        {units.map((unit, index) => <div key={unit.unitId}>
          <label><input type="checkbox" disabled={reserved.has(unit.unitId)} checked={selectedUnits.some(u => u.unitId === unit.unitId)}
            onChange={e => {
              const checked = e.target.checked
              setSelected(old => checked ? [...old, unit.unitId] : old.filter(id => id !== unit.unitId))
            }} />{unit.kind === 'LEADER' ? 'Lieutenant' : 'Infantry'} {index + 1} · {unit.hp}/{unit.maxHp} HP</label>
          {city.commanderId === unit.unitId ? <strong> Commander</strong>
            : unit.kind === 'LEADER' && !reserved.has(unit.unitId) &&
              <button onClick={() => edit({ kind: 'choose_commander', cityId: city.cityId, unitId: unit.unitId })}>Choose as commander</button>}
        </div>)}
        <button disabled={selectedUnits.filter(u => u.kind === 'LEADER').length !== 1}
          onClick={() => selectDispatch(selectedUnits.map(u => u.unitId))}>Set destination for selected units</button>
      </fieldset>
    </> : <p>You can recruit from cities you own.</p>}
    <h4>Recruitment queue</h4>
    {own.recruitment.length === 0 ? <p>No recruits queued.</p> : <ul aria-label="Your recruitment queue">
      {own.recruitment.map(order => <li key={order.recruitmentId}>
        {cityName(order.cityId)} · {order.quantity} {order.unitType === 'INFANTRY' ? 'Infantry' : 'Lieutenant'}
        {' · '}{order.paid.toLocaleString()} credits paid · Arrives Turn {order.arrivalTurn}
        <button disabled={!editable} onClick={() => edit({ kind: 'cancel_recruitment', recruitmentId: order.recruitmentId })}>Cancel and refund</button>
      </li>)}
    </ul>}
  </section>
}
