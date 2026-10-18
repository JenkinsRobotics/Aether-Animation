import type { RelationEditorValue } from "@aether/ui";
import type { RelationDTO, RelationSummary, RelationTypeSchema } from "./engine";

/** Display units mirror the native RelationDraft: mm/rev ↔ m/rad, mm ↔ m, deg ↔ rad. */
export function relationDraft(schema:RelationTypeSchema,relation?:RelationSummary):RelationEditorValue {
  return {kind:schema.kind,driver:relation?.driver??"",driven:relation?.driven??"",magnitude:relation?.ratio_field_value??1,reversed:relation?.reverse??false,
    offset:(relation?.offset??0)*(schema.driven_kind==="translation"?1000:180/Math.PI)};
}
export function relationDTO(value:RelationEditorValue,schema:RelationTypeSchema,existing?:RelationSummary):RelationDTO {
  if(!Number.isFinite(value.magnitude) || value.magnitude<=0 || !Number.isFinite(value.offset))throw new Error("Enter a positive relation value and a finite offset.");
  return {kind:value.kind,driver:value.driver,driven:value.driven,
    ratio:value.magnitude/(schema.ratio_field.unit==="mm"?2000*Math.PI:1)*(value.reversed?-1:1),
    offset:value.offset/(schema.driven_kind==="translation"?1000:180/Math.PI),
    display:existing?.display??{},suppressed:existing?.suppressed??false};
}
