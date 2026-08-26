export interface CanonicalTopic { id:string; displayName:string; aliases:string[]; moduleScope?:string; }
const clean=(s:string)=>s.toLowerCase().replace(/[’']/g,"'").replace(/[^a-z0-9]+/g," ").trim();
export function topicKey(name:string){const n=clean(name); const aliases:Record<string,string>={"op amp":"operational amplifiers","op amps":"operational amplifiers","operational amplifier":"operational amplifiers","kcl":"kirchhoff current law","kirchhoffs current law":"kirchhoff current law"};return aliases[n]||n;}
export function resolveTopic(name:string, topics:CanonicalTopic[], module?:string){const key=topicKey(name); return topics.find(t=>(!t.moduleScope||!module||t.moduleScope===module)&&[t.displayName,...t.aliases].some(a=>topicKey(a)===key));}
