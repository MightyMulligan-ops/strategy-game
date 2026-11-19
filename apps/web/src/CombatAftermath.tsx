import type {CombatAftermath as Aftermath} from '@strategy-game/shared-types'
import type {KeyboardEvent} from 'react'

/** Only authorized own fields enter this inspector. Loss membership is battle-wide. */
export default function CombatAftermath({view,turnNumber,geographic=false,city=false}:{view:Aftermath;turnNumber?:number;geographic?:boolean;city?:boolean}) {
 const outcomes={victory:'Victory',defeat:'Defeat',mutual_destruction:'Mutual destruction'}
 const ownership={own:'Your force receives ownership',ally:'An allied force receives ownership',opponent:'An opposing force receives ownership',unchanged:'Ownership unchanged'}
 function closeDisclosure(event:KeyboardEvent<HTMLDetailsElement>) {
  if(event.key!=='Escape')return
  event.preventDefault();event.stopPropagation();event.currentTarget.open=false
  event.currentTarget.querySelector('summary')?.focus()
 }
 return <>
  <p role="status">{turnNumber?`Turn ${turnNumber} resolved. Movement and battles are complete. Fresh planning is shown in the current turn panel.`:'Turn 1 resolved. Movement and battles are complete. Turn 2 has not opened.'}</p>
  <p>These results concern only your formations. {city?'City markers show your current holdings. This history records individual battle outcomes.':geographic?'Camp markers show your current ownership. This history records ownership at the end of the selected turn. Country borders do not show control.':'The map shows archived initial ownership; it is not a current ownership map.'}</p>
  {view.battles.length===0?<p>No battles involved your formations this turn.</p>:view.battles.map((b,i)=><article key={i}>
   <h3>{outcomes[b.outcome]}</h3>
   <p>{b.lostUnitIds.length} own {b.lostUnitIds.length===1?'unit lost':'units lost'} · {b.survivingUnitIds.length} own {b.survivingUnitIds.length===1?'unit survived':'units survived'}.</p>
   <p>Encounter position: {b.position.x}, {b.position.y}. Surviving formations' final positions are listed separately below.</p>
   <p>{b.ownership?<>Location {b.ownership.locationId}: {ownership[b.ownership.recipient]}.</>:'Off-city battle: no ownership transfer.'}</p>
   <details onKeyDown={closeDisclosure}>
    <summary>Inspect your participating formations and combined losses</summary>
    <ul>{b.ownFormationIds.map(id=>{
     const survivor=view.formations.find(f=>f.formationId===id)
     return <li key={id}>Own formation <span className="formation-id">{id}</span>: {survivor?`${survivor.units.length} surviving units; stored final position ${survivor.position.x}, ${survivor.position.y}.`:city?'See the units that survived this battle below. The formation may have consolidated into a city.':'Destroyed; no active formation remains. No final position is provided.'}</li>
    })}</ul>
    <h4>Combined own losses for these participating formations</h4>
    <p>Losses are grouped by battle; individual formation loss membership is not provided.</p>
    {b.lostUnitIds.length?<ul>{b.lostUnitIds.map(id=><li className="formation-id" key={id}>{id}</li>)}</ul>:<p>No own units lost.</p>}
    <h4>Own units surviving this battle</h4>
    {b.survivingUnitIds.length?<ul>{b.survivingUnitIds.map(id=><li className="formation-id" key={id}>{id}</li>)}</ul>:<p>No own units survived this battle.</p>}
   </details>
  </article>)}
  <h3>Your surviving formations</h3>
  {view.formations.length===0?<p>No active own formations remain. Destroyed participants are recorded above; this does not mean player elimination.</p>:<>
   <p>Stored final positions and own survivor HP. Includes formations that did not participate in a battle.</p>
   {view.formations.map(f=><details key={f.formationId} onKeyDown={closeDisclosure}>
    <summary>Inspect own formation <span className="formation-id">{f.formationId}</span> — {f.units.length} surviving {f.units.length===1?'unit':'units'}</summary>
    <p>Stored final position: {f.position.x}, {f.position.y}.</p>
    <ul>{f.units.map(u=><li key={u.unitId}>{u.kind==='LEADER'?'Lieutenant · Infantry specialization':'Infantry'}<dl>
     <dt>Own unit</dt><dd className="formation-id">{u.unitId}</dd><dt>HP</dt><dd>{u.hp}/{u.maxHp} HP</dd>
     <dt>Original spawn node</dt><dd className="formation-id">{u.originalSpawnNodeId}</dd>
    </dl></li>)}</ul>
   </details>)}
  </>}
 </>
}
