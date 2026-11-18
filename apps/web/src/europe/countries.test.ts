import {expect,it} from 'vitest'
import {countries,countryAt,insidePolygon} from './countries'
import {project} from './camera'
it('identifies countries from display borders, leaving ocean unlabelled',()=>{
 expect(countryAt(project(-3.7,40.4))).toBe('Spain')
 expect(countryAt(project(2.35,48.86))).toBe('France')
 expect(countryAt(project(-20,40))).toBeNull()
 expect(countries.every(c=>c.polygons.some(p=>insidePolygon(c.anchor,p)))).toBe(true)
})
it('honors polygon holes and separate islands',()=>{
 const ring=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]
 const hole=[{x:4,y:4},{x:6,y:4},{x:6,y:6},{x:4,y:6}]
 expect(insidePolygon({x:2,y:2},[ring,hole])).toBe(true)
 expect(insidePolygon({x:5,y:5},[ring,hole])).toBe(false)
 expect(insidePolygon({x:15,y:5},[ring,hole])).toBe(false)
})
