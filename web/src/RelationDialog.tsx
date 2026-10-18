import { useState } from "react";
import { Dialog, RelationEditor, type RelationEditorValue } from "@aether/ui";
import type { RelationDTO, RelationSummary, RelationTypeSchema, RigSummary } from "./engine";
import { relationDraft, relationDTO } from "./RelationPresentation";

/** The engine supplies kinds/DOFs and owns validation. Only display-unit conversion is local. */
export function RelationDialog({schema:initialSchema,schemas,relation,rig,onApply,onRemove,onClose}: {
  schema:RelationTypeSchema; schemas:readonly RelationTypeSchema[]; relation?:RelationSummary; rig:RigSummary;
  onApply:(relation:RelationDTO)=>Promise<void>; onRemove?:()=>Promise<void>; onClose:()=>void;
}) {
  const [value,setValue]=useState<RelationEditorValue>(()=>relationDraft(initialSchema,relation));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const schema=schemas.find(item=>item.kind===value.kind)??initialSchema;
  const dofs=rig.joints.flatMap(joint=>joint.dofs);
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError("");try{await action();onClose();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}};
  return <Dialog open title={relation?"Edit advanced relation":"Create advanced relation"} onClose={()=>{if(!busy)onClose();}}>
    <RelationEditor value={value} onChange={next=>{setValue(next);setError("");}} editing={!!relation} busy={busy} error={error}
      kinds={schemas.map(item=>({value:item.kind,label:item.label}))}
      drivers={dofs.filter(dof=>dof.kind===schema.driver_kind).map(dof=>({value:dof.path,label:dof.path}))}
      driven={dofs.filter(dof=>dof.kind===schema.driven_kind && dof.path!==value.driver && (!rig.relations.some(item=>item.driven===dof.path) || relation?.driven===dof.path)).map(dof=>({value:dof.path,label:dof.path}))}
      ratioLabel={schema.ratio_field.key==="distance_per_revolution"?"Distance per revolution":"Relation ratio"} ratioUnit={schema.ratio_field.unit==="mm"?"mm/rev":undefined} offsetUnit={schema.driven_kind==="translation"?"mm":"deg"}
      compatibility={`${schema.driver_kind} → ${schema.driven_kind}`}
      description="The animation engine validates dependencies, limits and motion. Changes are saved with this character."
      onApply={()=>void run(()=>onApply(relationDTO(value,schema,relation)))} onCancel={onClose} onRemove={onRemove?()=>void run(onRemove):undefined}/>
  </Dialog>;
}
