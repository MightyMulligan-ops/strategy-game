import {expect,it} from 'vitest'
import {countries,countryAt,insidePolygon,fitCountryLabel,interiorLabelAnchor,borderClearance} from './countries'
import {project} from './camera'
it('identifies countries from display borders, leaving ocean unlabelled',()=>{
 expect(countryAt(project(-3.7,40.4))).toBe('Spain')
 expect(countryAt(project(2.35,48.86))).toBe('France')
 expect(countryAt(project(-20,40))).toBeNull()
 expect(countries.every(c=>c.polygons.some(p=>insidePolygon(c.anchor,p)))).toBe(true)
})

it('keeps fitted label rectangles inside all countries across zoom scales',()=>{
 for(const country of countries)for(const scale of [1200,6000,16000,50000]){
  const label=fitCountryLabel(country,scale)
  if(!label)continue
  expect(label.fontSize).toBeLessThanOrEqual(22)
  for(const x of [-1,1])for(const y of [-1,1]){
   const corner={x:country.anchor.x+x*label.width/(2*scale),y:country.anchor.y+y*label.height/(2*scale)}
   expect(insidePolygon(corner,country.mainland),country.name).toBe(true)
   expect(borderClearance(corner,country.mainland),country.name).toBeGreaterThan(0)
  }
 }
})
it('uses interior space for concave polygons and scales small names without enlarging France',()=>{
 const polygon=[[{x:0,y:0},{x:10,y:0},{x:10,y:2},{x:2,y:2},{x:2,y:10},{x:0,y:10}]]
 const {anchor,clearance}=interiorLabelAnchor(polygon)
 expect(insidePolygon(anchor,polygon)).toBe(true);expect(clearance).toBeGreaterThan(.9)
 const france=countries.find(c=>c.name==='France')!
 expect(fitCountryLabel(france,50000)!.fontSize).toBe(22)
 expect(fitCountryLabel(france,100000)!.fontSize).toBe(22)
 const small={name:'Luxembourg',clearance:.001}
 expect(fitCountryLabel(small,2000)).toBeNull()
 expect(fitCountryLabel(small,100000)!.fontSize).toBeLessThanOrEqual(22)
})
it('honors polygon holes and separate islands',()=>{
 const ring=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]
 const hole=[{x:4,y:4},{x:6,y:4},{x:6,y:6},{x:4,y:6}]
 expect(insidePolygon({x:2,y:2},[ring,hole])).toBe(true)
 expect(insidePolygon({x:5,y:5},[ring,hole])).toBe(false)
 expect(insidePolygon({x:15,y:5},[ring,hole])).toBe(false)
})
