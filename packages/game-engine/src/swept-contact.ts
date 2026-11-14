/** Pinned swept-circle-lattice-v1. Geometry uses integer milliworld units and
 * exact BigInt predicates. Floating roots are audit/display data only. */
export type MilliPoint = Readonly<{ xMilli: number; yMilli: number }>;
export type Contact = Readonly<{ b: bigint; discriminant: bigint; a: bigint; parameter: number }>;
const radius = 20_000n;
const sign = (x: bigint) => x < 0n ? -1 : x > 0n ? 1 : 0;
function point(p: MilliPoint) {
  if (![p.xMilli,p.yMilli].every(Number.isSafeInteger)) throw new Error("Invalid authoritative coordinate");
  return [BigInt(p.xMilli),BigInt(p.yMilli)] as const;
}
export function squaredMilliDistance(a: MilliPoint,b: MilliPoint) {
  const [x,y]=point(a),[u,v]=point(b); return (x-u)**2n+(y-v)**2n;
}
export function sweptContact(from: MilliPoint,to: MilliPoint,target: MilliPoint): Contact | null {
  const [x,y]=point(from),[u,v]=point(to),[tx,ty]=point(target);
  const dx=u-x,dy=v-y,a=dx*dx+dy*dy,b=2n*((x-tx)*dx+(y-ty)*dy),c=(x-tx)**2n+(y-ty)**2n-radius*radius;
  if(c<=0n)return {a,b,discriminant:b*b-4n*a*c,parameter:0};
  if(a===0n||b>=0n)return null;
  const discriminant=b*b-4n*a*c;
  if(discriminant<0n)return null;
  const remaining=-b-2n*a;
  if(remaining>0n&&discriminant<remaining*remaining)return null;
  return Object.freeze({a,b,discriminant,parameter:2*Number(c)/(-Number(b)+Math.sqrt(Number(discriminant)))});
}
// sign(sqrt(a)-sqrt(b)-k), using exact comparisons rather than an epsilon.
function radicalDifference(a: bigint,b: bigint,k: bigint): number {
  if(k<0n)return -radicalDifference(b,a,-k);
  if(k===0n)return sign(a-b);
  if(a<b)return -1;
  const left=a-b-k*k;
  if(left<0n)return -1;
  return sign(left*left-4n*k*k*b);
}
export function compareContact(a: Contact,b: Contact): number {
  if(a.parameter===0||b.parameter===0)return a.parameter===0?(b.parameter===0?0:-1):1;
  if(a.a!==b.a)throw new Error("Contacts must share one movement segment");
  const comparison=radicalDifference(a.discriminant,b.discriminant,b.b-a.b);
  return comparison===0?0:-comparison;
}
function gcd(a: number,b: number): number { a=Math.abs(a);b=Math.abs(b);while(b){const next=a%b;a=b;b=next}return a; }
export function strictStoppingPoint(from: MilliPoint,to: MilliPoint,contact: Contact,hostiles: readonly MilliPoint[]): MilliPoint {
  if(contact.parameter===0)return Object.freeze({...from}); // Initial contact exception: never teleport.
  const dx=to.xMilli-from.xMilli,dy=to.yMilli-from.yMilli,steps=gcd(dx,dy);
  if(!steps)return Object.freeze({...from});
  const n=BigInt(steps);
  // Reconstruct C from the exact discriminant; no rounded contact root controls state.
  const a=contact.a,b=contact.b,c=(b*b-contact.discriminant)/(4n*a);
  const before=(k:number)=>{const t=BigInt(k);return 2n*a*t+b*n<0n&&a*t*t+b*t*n+c*n*n>0n};
  let low=0,high=steps;
  while(low<high){const mid=Math.ceil((low+high)/2);if(before(mid))low=mid;else high=mid-1}
  const result=Object.freeze({xMilli:from.xMilli+dx/steps*low,yMilli:from.yMilli+dy/steps*low});
  // Every representable point lies exactly on the path, including coprime diagonals.
  if(hostiles.some(p=>squaredMilliDistance(result,p)<=radius*radius))throw new Error("Invalid non-contact stopping point");
  return result;
}
