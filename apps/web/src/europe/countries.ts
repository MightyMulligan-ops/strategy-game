import geography from './geography.json'
import { project } from './camera'
import type { Point } from './camera'

type Polygon = readonly (readonly Point[])[]
export function insideRing(point: Point, ring: readonly Point[]): boolean {
  let inside = false
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i]!,b=ring[j]!
    if ((a.y>point.y)!==(b.y>point.y) && point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) inside=!inside
  }
  return inside
}
export function insidePolygon(point: Point, polygon: Polygon): boolean {
  return !!polygon[0] && insideRing(point,polygon[0]) && !polygon.slice(1).some(hole=>insideRing(point,hole))
}
const area=(ring:readonly Point[])=>Math.abs(ring.reduce((a,p,i)=>{const q=ring[(i+1)%ring.length]!;return a+p.x*q.y-q.x*p.y},0)/2)
export const countries=geography.countries.map(country=>{
  const polygons=country.polygons.map(p=>p.map(r=>r.map(([lon,lat])=>project(lon!,lat!))))
  const largest=[...polygons].sort((a,b)=>area(b[0]!)-area(a[0]!))[0]!,ring=largest[0]!
  const bounds={left:Math.min(...ring.map(p=>p.x)),right:Math.max(...ring.map(p=>p.x)),top:Math.min(...ring.map(p=>p.y)),bottom:Math.max(...ring.map(p=>p.y))}
  const middle={x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2}
  // Choose an actual interior display anchor, never an ownership/gameplay point.
  const candidates:Point[]=[middle]
  for(let y=1;y<20;y++)for(let x=1;x<20;x++)candidates.push({x:bounds.left+(bounds.right-bounds.left)*x/20,y:bounds.top+(bounds.bottom-bounds.top)*y/20})
  const anchor=candidates.filter(p=>insidePolygon(p,largest)).sort((a,b)=>Math.hypot(a.x-middle.x,a.y-middle.y)-Math.hypot(b.x-middle.x,b.y-middle.y))[0]??ring[0]!
  return {name:country.name,polygons,anchor,bounds}
})
export const countryAt=(point:Point)=>countries.find(c=>c.polygons.some(p=>insidePolygon(point,p)))?.name??null
