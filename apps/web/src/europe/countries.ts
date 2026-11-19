import geography from './geography.json'
import { project } from './camera'
import type { Point } from './camera'

export type Polygon = readonly (readonly Point[])[]
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
function edgeDistance(p:Point,a:Point,b:Point):number {
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy
  const t=length===0?0:Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length))
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)
}
/** Includes lake/enclave holes: an interior circle cannot cross a display border. */
export function borderClearance(p:Point,polygon:Polygon):number {
  const distance=Math.min(...polygon.flatMap(r=>r.map((a,i)=>edgeDistance(p,a,r[(i+1)%r.length]!))))
  return insidePolygon(p,polygon)?distance:-distance
}
export function interiorLabelAnchor(polygon:Polygon) {
  const ring=polygon[0]!
  const bounds={left:Math.min(...ring.map(p=>p.x)),right:Math.max(...ring.map(p=>p.x)),top:Math.min(...ring.map(p=>p.y)),bottom:Math.max(...ring.map(p=>p.y))}
  let anchor={x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2}
  let clearance=borderClearance(anchor,polygon)
  for(let y=1;y<24;y++)for(let x=1;x<24;x++){
    const p={x:bounds.left+(bounds.right-bounds.left)*x/24,y:bounds.top+(bounds.bottom-bounds.top)*y/24},d=borderClearance(p,polygon)
    if(d>clearance){anchor=p;clearance=d}
  }
  let step=Math.max(bounds.right-bounds.left,bounds.bottom-bounds.top)/24
  for(let pass=0;pass<12;pass++){
    const center=anchor
    for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
      const p={x:center.x+x*step,y:center.y+y*step},d=borderClearance(p,polygon)
      if(d>clearance){anchor=p;clearance=d}
    }
    step/=2
  }
  return {anchor,clearance:Math.max(0,clearance),bounds}
}
export const countries=geography.countries.map(country=>{
  const polygons=country.polygons.map(p=>p.map(r=>r.map(([lon,lat])=>project(lon!,lat!))))
  const mainland=[...polygons].sort((a,b)=>area(b[0]!)-area(a[0]!))[0]!
  return {name:country.name,polygons,mainland,...interiorLabelAnchor(mainland)}
})
export type DisplayCountry = typeof countries[number]
/** Conservative text rectangle wholly inside the country's interior circle. */
export function fitCountryLabel(country:Pick<DisplayCountry,'name'|'clearance'>,scale:number) {
  const widthRatio=country.name.length*1.05,heightRatio=1.4
  const radius=Math.max(0,country.clearance*scale-3)
  const fontSize=Math.min(22,2*radius/Math.hypot(widthRatio,heightRatio))
  if(fontSize<9)return null // Hover/search remain available for tiny countries.
  return {fontSize,width:widthRatio*fontSize,height:heightRatio*fontSize}
}
export const countryAt=(point:Point)=>countries.find(c=>c.polygons.some(p=>insidePolygon(point,p)))?.name??null
