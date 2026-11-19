// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {useAutoRefresh} from './useAutoRefresh'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let host:HTMLDivElement,root:ReturnType<typeof createRoot>
const refresh=vi.fn<()=>Promise<boolean>>()
function Probe({enabled=true}:{enabled?:boolean}){useAutoRefresh(refresh,enabled);return null}
beforeEach(()=>{vi.useFakeTimers();refresh.mockReset().mockResolvedValue(true);host=document.createElement('div');document.body.append(host);root=createRoot(host);Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'})})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();Reflect.deleteProperty(document,'visibilityState')})
const tick=(ms:number)=>act(async()=>vi.advanceTimersByTimeAsync(ms))
it('polls reads without overlap and stops on unmount',async()=>{
 let finish!:(v:boolean)=>void;refresh.mockImplementationOnce(()=>new Promise(r=>{finish=r}));await act(async()=>root.render(<Probe/>));await tick(10_000);expect(refresh).toHaveBeenCalledTimes(1);await tick(60_000);await act(async()=>window.dispatchEvent(new Event('focus')));expect(refresh).toHaveBeenCalledTimes(1);await act(async()=>finish(true));await tick(10_000);expect(refresh).toHaveBeenCalledTimes(2);await act(async()=>root.render(<Probe enabled={false}/>));await tick(60_000);expect(refresh).toHaveBeenCalledTimes(2)
})
it('backs off failures, pauses hidden tabs and refreshes when visible',async()=>{
 refresh.mockResolvedValueOnce(false);await act(async()=>root.render(<Probe/>));await tick(10_000);await tick(19_999);expect(refresh).toHaveBeenCalledTimes(1);await tick(1);expect(refresh).toHaveBeenCalledTimes(2);Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});await tick(10_000);expect(refresh).toHaveBeenCalledTimes(2);Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(refresh).toHaveBeenCalledTimes(3)
})
