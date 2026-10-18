import { Button, Inspector, InspectorSection, InspectorActions, FieldRow, Slider } from "@aether/ui";
import type { DofSummary } from "./engine";

export interface DofState extends DofSummary {
  shown: number;
  touched: boolean;
}

export interface PosePanelProps {
  dofs: readonly DofState[];
  onChange: (index: number, value: number) => void;
  onReset: () => void;
}

/** Live DOF override sliders (the Pose inspector panel). */
export function PosePanel({ dofs, onChange, onReset }: PosePanelProps) {
  return (
    <Inspector><InspectorSection title="Pose">
      {dofs.map((dof, index) => (
        <FieldRow key={dof.path} label={dof.path} modified={dof.touched}>
          <Slider ariaLabel={dof.path}
            min={dof.min ?? (dof.neutral ?? 0) - Math.PI}
            max={dof.max ?? (dof.neutral ?? 0) + Math.PI}
            step={0.001}
            value={dof.shown}
            onChange={value => onChange(index, value)}
          />
        </FieldRow>
      ))}
      {dofs.some((dof) => dof.touched) ? (
        <InspectorActions><Button onClick={onReset}>Reset pose overrides</Button></InspectorActions>
      ) : null}
    </InspectorSection></Inspector>
  );
}
