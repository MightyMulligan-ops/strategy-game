import {describe,it,expect} from 'vitest';
import {europeLonLatToDisplay,europeDisplayToMask,europeMaskToDisplay,europeDisplayToLonLat,europeLonLatToMask} from '../src/europe-map.js';
describe('Europe source projection, independent of gameplay distance policy',()=>{
 it.each([[-25,72],[60,25],[-3.7038,40.4168],[6.140028,46.210008]])('round trips %s,%s within half a mask unit',(lon,lat)=>{
  const display=europeLonLatToDisplay(lon!,lat!),mask=europeDisplayToMask(display),back=europeMaskToDisplay(mask);
  expect(Math.abs(back.x-display.x)).toBeLessThanOrEqual(0.500001/4_000_000);
  expect(Math.abs(back.y-display.y)).toBeLessThanOrEqual(0.500001/4_000_000);
  const geo=europeDisplayToLonLat(display);expect(geo.lon).toBeCloseTo(lon!,10);expect(geo.lat).toBeCloseTo(lat!,10);
 });
 it('maps theatre endpoints to the original immutable integer bounds',()=>{
  expect(europeLonLatToMask(-25,72)).toEqual({x:0,y:0});
  expect(europeLonLatToMask(60,25)).toEqual({x:944444,y:886082});
 });
 it.each([{x:NaN,y:0},{x:Infinity,y:0},{x:-1,y:1},{x:1.1,y:1},{x:944445,y:0}])('rejects invalid integer input %s',p=>expect(()=>europeMaskToDisplay(p)).toThrow(RangeError));
 it.each([[-25.001,72],[60.001,25],[0,24.99],[0,72.01],[NaN,40]])('rejects invalid geography without clamping', (lon,lat)=>expect(()=>europeLonLatToMask(lon!,lat!)).toThrow(RangeError));
 it('never changes a valid point to a nearby land or city anchor',()=>{
  const p=europeLonLatToMask(6.140028,46.210008);
  expect(p).toEqual(europeDisplayToMask(europeLonLatToDisplay(6.140028,46.210008)));
 });
});

import {EUROPE_SCENARIO_VIEW,europeGameToDisplay,europeDisplayToGame} from '../src/europe-map.js';
import {EuropeCommandSchema,LoopCommandSchema} from '../src/loop.js';
const {originX,originY,maskPerGame,width,height,...profile}=EUROPE_SCENARIO_VIEW;void originX;void originY;void maskPerGame;void width;void height;
it('round trips integer scenario commands and milli combat points without mask snapping',()=>{
 for(const p of [{x:0,y:0},{x:1000,y:500},{x:240,y:240}])expect(europeDisplayToGame(europeGameToDisplay(p))).toEqual(p);
 const p={x:240.123,y:240.456},d=europeGameToDisplay(p);expect(europeDisplayToGame(d)).toEqual({x:240,y:240});
 expect(()=>europeGameToDisplay({x:-1,y:0})).toThrow();
});
it('keeps historical and Europe commands strict and mutually incompatible',()=>{
 const command={schemaVersion:2,profile,turnNumber:2,expectedRevision:0,kind:'set_ready',ready:true};
 expect(EuropeCommandSchema.safeParse(command).success).toBe(true);expect(LoopCommandSchema.safeParse(command).success).toBe(false);
 for(const field of ['domain','origin','mask','camera','owner'])expect(EuropeCommandSchema.safeParse({...command,[field]:'untrusted'}).success).toBe(false);
 expect(EuropeCommandSchema.safeParse({...command,profile:{...profile,maskId:'old'}}).success).toBe(false);
});
