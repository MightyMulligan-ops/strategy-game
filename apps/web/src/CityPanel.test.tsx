// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { CITY_BALANCE_V1 } from '@strategy-game/shared-types'
import type { CityPlan, CityProjection } from '@strategy-game/shared-types'
import CityPanel from './CityPanel'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test('uses the private treasury and queue, and a Ready refresh locks the same controls', async () => {
  const city: CityProjection = { cityId: 'madrid', name: 'Madrid', capital: true, position: { x: 368, y: 463 },
    owned: true, neutral: false, garrisonId: null, commanderId: null }
  const own: CityPlan = { credits: 1600, commanders: [], dispatches: [], recruitment: [
    { recruitmentId: '37d5bdee-08c1-4af6-b120-17a05ca161ff', cityId: 'madrid', unitType: 'LIEUTENANT',
      quantity: 2, paid: 400, arrivalTurn: 2 }
  ] }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host), edit = vi.fn()
  const render = (editable: boolean) => act(() => root.render(<CityPanel city={city} cities={[city]} own={own}
    balance={{ ...CITY_BALANCE_V1, startingCredits: 2000 }} units={[]} editable={editable} edit={edit} selectDispatch={vi.fn()} />))
  try {
    await render(true)
    expect(host.textContent).toContain('1,600 credits')
    expect(host.textContent).toContain('Total price: 100 credits')
    expect(host.textContent).toContain('Madrid · 2 Lieutenant · 400 credits paid · Arrives Turn 2')
    const cancel = [...host.querySelectorAll('button')].find(b => b.textContent === 'Cancel and refund')!
    await act(() => cancel.click())
    expect(edit).toHaveBeenCalledExactlyOnceWith({ kind: 'cancel_recruitment', recruitmentId: own.recruitment[0]!.recruitmentId })
    await render(false)
    expect(cancel.disabled).toBe(true)
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    await act(() => cancel.click())
    expect(edit).toHaveBeenCalledTimes(1)
  } finally {
    await act(() => root.unmount())
    host.remove()
  }
})
