import {beforeAll,describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareSurfaceNavigation} from '../src/surface-navigation.js';
import {europeLonLatToMask} from '@strategy-game/shared-types';
const asset=(name:string)=>readFileSync(new URL(`../src/europe-assets/${name}.json`,import.meta.url),'utf8');
const maskBytes=asset('surface-mask'),manifest=JSON.parse(asset('surface-manifest')),review=JSON.parse(asset('surface-review'));
let surface:ReturnType<typeof prepareSurfaceNavigation>;
beforeAll(()=>{surface=prepareSurfaceNavigation(JSON.parse(maskBytes))},20000);
describe('selected authoritative Europe source asset',()=>{
 it('retains the exact published mask bytes and provenance',()=>{
  expect(createHash('sha256').update(maskBytes).digest('hex')).toBe('052b866179d2566fd37b2f22301d48c5e5fcec3f97e6e4bd806dcdc78374bfe6');
  expect(manifest.sha256).toBe(createHash('sha256').update(maskBytes).digest('hex'));
  expect(surface.maskId).toBe('europe-ne10m-surface-v2');
 });
 it('keeps Geneva blocked as inland water, without silently snapping',()=>{
  const geneva=europeLonLatToMask(6.140028,46.210008);
  expect(surface.classifyPoint(geneva)).toBe('INLAND_WATER');
  expect(surface.validateRoute('LAND',[geneva,geneva])).toMatchObject({eligible:false,reason:'INLAND_WATER_BLOCKED'});
 });
 it('retains every reviewed physical anchor',()=>{
  for(const p of review.points)expect(surface.classifyPoint(europeLonLatToMask(p.lon,p.lat)),p.name).toBe(p.expected);
 });
 it('retains full-segment water/island checks in both directions',()=>{
  for(const r of review.routes){
   const points=r.points.map(([lon,lat]:[number,number])=>europeLonLatToMask(lon,lat));
   expect(surface.validateRoute(r.domain,points).eligible,r.name).toBe(r.eligible);
   expect(surface.validateRoute(r.domain,[...points].reverse()).eligible,r.name).toBe(r.eligible);
  }
 });
});
