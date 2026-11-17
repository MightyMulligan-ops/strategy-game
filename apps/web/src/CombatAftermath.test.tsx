// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
import MovementResolution from "./MovementResolution";
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
it("renders own losses, survival and ownership without opening Turn2; reconnect clears stale private state",async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),session=vi.fn(async()=>{});
 const data={schemaVersion:2,matchId:"match",state:"RESOLVED",formations:[],battles:[{outcome:"mutual_destruction",ownFormationIds:[`formation:${'a'.repeat(64)}`],lostUnitIds:["own-lost"],survivingUnitIds:[],position:{x:100,y:100},ownership:{locationId:"city",recipient:"unchanged"}}]};
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(data)));vi.stubGlobal("fetch",fetcher);
 try{await act(async()=>root.render(<MovementResolution combat matchId="match" onSessionError={session}/>));
  expect(host.textContent).toContain("Movement and battles are complete");expect(host.textContent).toContain("Turn 2 has not opened");expect(host.textContent).toContain("1 own units lost");expect(host.textContent).toContain("ownership unchanged");expect(host.textContent).toContain("own-lost");
  expect(fetcher.mock.calls[0]![0]).toContain("/aftermath");expect(fetcher.mock.calls.every(([,o])=>o.method==="GET")).toBe(true);
  fetcher.mockResolvedValue(new Response('{}',{status:401}));await act(async()=>window.dispatchEvent(new Event('online')));expect(session).toHaveBeenCalledOnce();expect(host.textContent).not.toContain("own-lost");
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
});
