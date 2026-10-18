import {test} from 'node:test';
import assert from 'node:assert/strict';
import {relationDraft,relationDTO} from './RelationPresentation.ts';
const schema={kind:'rack_pinion',label:'Rack and pinion',driver_kind:'rotation',driven_kind:'translation',ratio_field:{key:'distance_per_revolution',unit:'mm'},reverse_supported:true};
test('native mm/revolution and mm display values round trip canonical SI data',()=>{
 const source={kind:'rack_pinion',driver:'steering.rotation',driven:'rack.travel',ratio:-.02,offset:.003,ratio_field_value:.02*2*Math.PI*1000,reverse:true,magnitude:.02,display:{pinion_diameter_mm:40},suppressed:true};
 const draft=relationDraft(schema,source);assert.equal(draft.offset,3);assert.equal(draft.reversed,true);
 const result=relationDTO(draft,schema,source);assert.ok(Math.abs(result.ratio+.02)<1e-12);
 assert.deepEqual({...result,ratio:-.02},{kind:source.kind,driver:source.driver,driven:source.driven,ratio:-.02,offset:.003,display:source.display,suppressed:true});
});
test('angular offset is converted once; negative direction stays in signed ratio',()=>{
 const gear={...schema,kind:'gear',driven_kind:'rotation',ratio_field:{key:'relation_ratio',unit:'ratio'}};
 const dto=relationDTO({...relationDraft(gear),driver:'a',driven:'b',magnitude:2,reversed:true,offset:90},gear);
 assert.equal(dto.ratio,-2);assert.equal(dto.offset,Math.PI/2);
});
test('invalid edits cannot become serialized relation values',()=>{
 for(const magnitude of [0,-1,NaN,Infinity])assert.throws(()=>relationDTO({...relationDraft(schema),magnitude},schema));
 assert.throws(()=>relationDTO({...relationDraft(schema),offset:NaN},schema));
});
