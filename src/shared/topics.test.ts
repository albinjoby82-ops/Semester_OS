import {describe,expect,it} from "vitest";import {resolveTopic,topicKey} from "./topics";
describe("canonical topics",()=>{it("normalizes common aliases",()=>expect(topicKey("Op-amp circuits")).toBe("op amp circuits"));it("resolves scoped aliases",()=>expect(resolveTopic("KCL",[{id:"1",displayName:"Kirchhoff Current Law",aliases:[],moduleScope:"EC"}],"EC")?.id).toBe("1"));});
