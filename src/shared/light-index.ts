export const LIGHT_INDEX_SCHEMA = 1;
export interface LightTopic { name: string; aliases?: string[]; startPage: number; endPage: number; confidence?: number; }
export interface LightDocumentIndex { schemaVersion: number; title: string; week?: number; shortDescription?: string; topics: LightTopic[]; keywords: string[]; generatedAt: string; provider: string; model?: string; }
export function validateLightIndex(value: unknown, pageCount?: number): LightDocumentIndex | null {
  if (!value || typeof value !== "object") return null;
  const v=value as Partial<LightDocumentIndex>;
  if (v.schemaVersion !== LIGHT_INDEX_SCHEMA || typeof v.title !== "string" || !Array.isArray(v.topics) || !Array.isArray(v.keywords)) return null;
  const valid=(t: unknown): t is LightTopic => { if(!t || typeof t!=="object") return false; const x=t as LightTopic; return typeof x.name === "string" && x.name.trim().length>0 && Number.isInteger(x.startPage) && Number.isInteger(x.endPage) && x.startPage>=1 && x.endPage>=x.startPage && (!pageCount || x.endPage<=pageCount); };
  if (v.topics.some(t => !valid(t))) return null;
  const topics=v.topics.slice(0,20) as LightTopic[];
  const keywords=[...new Set(v.keywords.filter(k=>typeof k === "string" && k.trim()).map(k=>k.trim()))].slice(0,30);
  return { schemaVersion:LIGHT_INDEX_SCHEMA,title:v.title.trim(),week:Number.isInteger(v.week)&&Number(v.week)>0&&Number(v.week)<=52?Number(v.week):undefined,shortDescription:typeof v.shortDescription === "string"?v.shortDescription.slice(0,240):undefined,topics,keywords,generatedAt:typeof v.generatedAt === "string"?v.generatedAt:new Date().toISOString(),provider:typeof v.provider === "string"?v.provider:"unknown",model:typeof v.model === "string"?v.model:undefined };
}
