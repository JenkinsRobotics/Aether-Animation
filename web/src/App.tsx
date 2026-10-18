import { AnimationFileBar } from "./AnimationFileBar";
import { useContextCommands } from '@aether/ui';
import { useStudioApplications } from "@aether/session/applications";
import { studioAgentService } from "@aether/session/agent";
import { WorkspaceAgent, type AssistantMessage } from "@aether/ui";
import { useDocumentConnection } from "@aether/session/useDocumentConnection";
import { documentRequest, encodeDocument, decodeDocument, type HostedDocument } from "@aether/session/documents";
import { SaveError, AutosaveSession, readRecovery, recoveryKey, sessionOwner } from "@aether/session/autosave";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button, FieldRow, Inspector, InspectorSection, InspectorActions,
  AetherIcon,
  StudioDocumentBar as DocumentBar,
  WorkspaceSwitcher, MenuButton,
  StudioModeButton,
  WorkspaceWindowMenu,
  StatusDot,
  TreePanel,
  ViewportCanvas,
  ViewportNavigationCube,
  type ViewportOrientation,
  type AetherIconName,
  WorkspaceRibbon,
  type WorkspaceRibbonTab,
  StudioWorkspace as WorkspaceShell,
  standardWorkspacePanels,
} from "@aether/ui";
import type { LayoutPreset, StatusKind, TreeNode, WorkspacePanel } from "@aether/ui";
import {
  addMate,
  relationTypes, addRelation, updateRelation, removeRelation,
  fetchCharacterText,
  loadCharacter,
  mateTypes,
  removeMate,
  resolvePose,
  saveFile,
  fileRevision,
  serializeCharacter,
} from "./engine";
import type {
  ClipSummary,
  ConnectorDTO,
  MateTypeSchema,
  RigSummary, RelationTypeSchema, RelationSummary,
} from "./engine";
import { previewMate } from "./engine";
import { AnimationViewport } from "./viewport";
import { MateDialog, draftToJoint } from "./MateDialog";
import type { MateDraft } from "./MateDialog";
import { RelationDialog } from "./RelationDialog";
import { TimelinePanel } from "./TimelinePanel";
import { PosePanel } from "./PosePanel";
import type { DofState } from "./PosePanel";

const DEFAULT_CHARACTER = "examples/pan_tilt_head.character.anima";
const PRESET_KEY = "aether.layoutPreset";

/** The workspaces the ribbon offers, and the tool tabs each one carries. */
const ANIMATION_WORKSPACES = [
  { id: "assets", label: "Assets", icon: <AetherIcon name="import" /> },
  { id: "modeling", label: "3D Modeling", icon: <AetherIcon name="design" /> },
  { id: "animate", label: "Animate", icon: <AetherIcon name="animate" /> },
  { id: "show", label: "Show", icon: <AetherIcon name="show" />, disabled: true, disabledReason: "Show is awaiting the web session bridge." },
  { id: "hardware", label: "Hardware", icon: <AetherIcon name="hardware" />, disabled: true, disabledReason: "Hardware is awaiting the web output session bridge." },
] as const;

const TOOL_ICONS: Record<string, AetherIconName> = {
  fastened: "fastened", parallel: "parallel", revolute: "revolute",
  prismatic: "slider", cylindrical: "cylindrical", pin_slot: "pin_slot",
  planar: "planar", ball: "ball",
};

export function App() {
  const applications = useStudioApplications();
  const [saveStatus, setSaveStatus] = useState('');
  const [agentMessages,setAgentMessages]=useState<AssistantMessage[]>([]);
  const viewportRef = useRef<AnimationViewport | null>(null);
  useContextCommands([{ id:'zoom-fit', label:'Fit view', heading:'View', run:() => { viewportRef.current?.fitView(); } }]);
  const [cameraOrientation, setCameraOrientation] = useState<ViewportOrientation>([0, 0, 0, 1]);
  const [status, setStatus] = useState("connecting to engine…");
  const [statusKind, setStatusKind] = useState<StatusKind>("busy");
  // Deep links for review: ?workspace=assets|modeling|animate&clip=<name>
  const [workspace, setWorkspace] = useState(
    () => new URLSearchParams(location.search).get("workspace") ?? "modeling"
  );
  const [preset, setPreset] = useState<LayoutPreset>(() => {
    const stored = localStorage.getItem(PRESET_KEY);
    return stored === "floating" || stored === "canvas" || stored === "docked" ? stored : "floating";
  });
  const [rig, setRig] = useState<RigSummary | null>(null);
  const rigRef = useRef<RigSummary | null>(null);
  const [rawRig, setRawRig] = useState<unknown>(null);
  const handleRef = useRef<string | null>(null);
  const autosave = useRef<AutosaveSession<{ revision: string | null; file: HostedDocument | null }> | null>(null);
  const [hostFile,setHostFile]=useState<HostedDocument|null>(null);
  const bootSerial = useRef(0);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [dofs, setDofs] = useState<DofState[]>([]);
  const [activeClip, setActiveClip] = useState<ClipSummary | null>(null);
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(0);
  const [timeS, setTimeS] = useState(0);
  const poseBusy = useRef(false);
  const poseDirty = useRef(false);
  const [mateSchemas, setMateSchemas] = useState<MateTypeSchema[]>([]);
  const [mateDraft, setMateDraft] = useState<MateDraft | null>(null);
  const mateDraftRef = useRef<MateDraft | null>(null);
  const [mateBusy, setMateBusy] = useState(false);
  const [relationSchemas,setRelationSchemas]=useState<RelationTypeSchema[]>([]);
  const [relationDraft,setRelationDraft]=useState<{schema:RelationTypeSchema;relation?:RelationSummary}|null>(null);

  const choosePreset = useCallback((next: LayoutPreset) => {
    localStorage.setItem(PRESET_KEY, next);
    setPreset(next);
  }, []);

  const requestPose = useCallback(() => {
    poseDirty.current = true;
  }, []);

  const adoptRig = useCallback(async (loadedRig: RigSummary, raw: unknown) => {
    rigRef.current = loadedRig;
    setRig(loadedRig);
    setRawRig(raw);
    autosave.current?.write(JSON.stringify(raw));
    setDofs(
      loadedRig.joints.flatMap((joint) =>
        joint.dofs.map((dof) => ({
          ...dof,
          shown: dof.neutral ?? 0,
          touched: false,
        }))
      )
    );
    await viewportRef.current?.setParts(loadedRig.parts, DEFAULT_CHARACTER);
    poseDirty.current = true;
    setStatus(
      `${loadedRig.identity.display_name ?? loadedRig.identity.name} — ` +
        `${loadedRig.parts.length} parts · ${loadedRig.joints.length} mates · ` +
        `${loadedRig.clips.length} clips`
    );
    setStatusKind("ok");
  }, []);

  const documentConnection=useDocumentConnection({app:'animation',id:hostFile?.id,name:hostFile?.name??'Character',writable:hostFile?.writable,flush:async()=>{
    const session=autosave.current;if(!session)throw new Error('Wait for the character to finish loading.');
    await session.flush();if(session.dirty)await session.flush();if(session.dirty)throw new Error('Resolve the save conflict before changing versions.');
  },saveCopy:async()=>{
    if(!rawRig)throw new Error('Load a character before making a copy.');
    const serialized=await serializeCharacter(rawRig);
    const file=await documentRequest<HostedDocument>('animation','create',{name:(hostFile?.name??'Character.anima').replace(/(\.[^.]+)$/,' copy$1'),scope:'personal',data_base64:encodeDocument(serialized.text)});
    autosave.current?.dispose();location.assign(`/animation/index.html?document=${encodeURIComponent(file.id)}`);
  }});

  // ---- engine boot -----------------------------------------------------
  const boot = useCallback(async () => {
    const serial = ++bootSerial.current;
    try {
      setStatus("connecting to engine…");
      setStatusKind("busy");
      const hosted=location.pathname.startsWith('/animation/');
      const owner=hosted?await sessionOwner():'local';
      const query=new URLSearchParams(location.search),id=query.get('document'),branch=query.get('branch')??'Main';
      const stored=hosted&&id?await documentRequest<HostedDocument>('animation','read',{id,branch}):null;
      const draft=query.get('draft')??crypto.randomUUID();
      if(hosted&&!id){query.set('draft',draft);history.replaceState(null,'',`${location.pathname}?${query}`);}
      const keyForBase=(base:{file:HostedDocument|null})=>recoveryKey('animation',owner,hosted?`${base.file?.id??draft}:${branch}`:DEFAULT_CHARACTER);
      const key=keyForBase({file:stored});
      const recovery=readRecovery<{revision:string|null;file:HostedDocument|null}>(key);
      const text=stored?decodeDocument(stored.data_base64!):await fetchCharacterText(DEFAULT_CHARACTER);
      const original=await loadCharacter(text);
      const latestRevision=hosted?String(stored?.revision??0):fileRevision(DEFAULT_CHARACTER);
      if(serial!==bootSerial.current)return;
      autosave.current?.dispose();
      const session=new AutosaveSession<{ revision: string | null; file: HostedDocument | null }>({key,base:{revision:latestRevision,file:stored?{id:stored.id,name:stored.name,revision:stored.revision,writable:stored.writable,branch:stored.branch}:null},text:JSON.stringify(original.rig),keyForBase,
        save:async(raw,base)=>{
          const serialized=await serializeCharacter(JSON.parse(raw));
          if(!hosted)return {revision:await saveFile(DEFAULT_CHARACTER,serialized.text,base.revision),file:null};
          if(base.file?.writable===false)throw new SaveError('This document is read only.',403);
          const file=await documentRequest<HostedDocument>('animation',base.file?'save':'create',base.file?{id:base.file.id,branch,expected_revision:base.file.revision,data_base64:encodeDocument(serialized.text)}:{name:`${original.rig.identity.name??'Character'}.character.anima`,kind:'file',scope:'personal',data_base64:encodeDocument(serialized.text)});
          return {revision:String(file.revision),file};
        },
      });
      autosave.current = session;
      session.subscribe(state => {
        if(session.base.file){setHostFile(session.base.file);const q=new URLSearchParams(location.search);q.set('document',session.base.file.id);q.delete('draft');q.delete('new');history.replaceState(null,'',`${location.pathname}?${q}`);}

        if (state.phase === "saved") { setSaveStatus("Saved"); setStatusKind("ok"); }
        else if (state.phase === "saving") { setSaveStatus("Saving…"); setStatusKind("busy"); }
        else if (state.message) { setSaveStatus(`${state.message}${state.durable ? " Edits are recoverable in this tab." : ""}`); setStatusKind("warn"); }
      });
      let loaded = original;
      if (recovery && (recovery.blocked || recovery.text !== JSON.stringify(original.rig))) {
        const recovered = await serializeCharacter(JSON.parse(recovery.text));
        loaded = await loadCharacter(recovered.text);
        session.recover(recovery, latestRevision !== recovery.base.revision);
      }
      if (serial !== bootSerial.current) { session.dispose(); return; }
      handleRef.current = loaded.handle;
      await adoptRig(loaded.rig, loaded.rig);
      if(hosted&&!stored)session.write(JSON.stringify(loaded.rig),true);
      const types = await mateTypes();
      const relations = await relationTypes();
      if (serial !== bootSerial.current) return;
      setRelationSchemas(relations.relation_types);
      setMateSchemas(types.mate_types.filter((schema) => schema.category === "kinematic"));
      const clipParam = new URLSearchParams(location.search).get("clip");
      if (clipParam) {
        const clip = loaded.rig.clips.find((entry) => entry.name === clipParam);
        if (clip) setActiveClip(clip);
      }
    } catch (error) {
      setStatus(
        `engine unavailable: ${(error as Error).message} — ` +
          "run: .venv/bin/python -m aether_animation.httpbridge"
      );
      setStatusKind("error");
    }
  }, [adoptRig]);

  useEffect(() => {
    void boot();
    return () => { bootSerial.current++; autosave.current?.dispose(); autosave.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- pose loop (coalesced; one request in flight) --------------------
  useEffect(() => {
    let cancelled = false;
    let lastTick = performance.now();
    const tick = async (now: number) => {
      if (cancelled) return;
      const delta = (now - lastTick) / 1000;
      lastTick = now;
      if (playing && activeClip) {
        timeRef.current += delta;
        if (timeRef.current > activeClip.duration_s) {
          if (activeClip.loop) {
            timeRef.current %= Math.max(activeClip.duration_s, 1e-6);
          } else {
            timeRef.current = activeClip.duration_s;
            setPlaying(false);
          }
        }
        setTimeS(timeRef.current);
        poseDirty.current = true;
      }
      if (poseDirty.current && !poseBusy.current && handleRef.current) {
        poseDirty.current = false;
        poseBusy.current = true;
        try {
          const dofValues: Record<string, number> = {};
          for (const dof of dofs) if (dof.touched) dofValues[dof.path] = dof.shown;
          const pose = await resolvePose(handleRef.current, {
            clip: activeClip?.name,
            timeS: timeRef.current,
            dofValues,
          });
          viewportRef.current?.applyPose(pose.parts);
        } catch {
          // transient engine errors surface via the next status update
        } finally {
          poseBusy.current = false;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [playing, activeClip, dofs]);

  // ---- selection -------------------------------------------------------
  const select = useCallback(
    (ids: readonly string[], mode: "single" | "toggle" | "range") => {
      setSelection((current) => {
        let next: Set<string>;
        if (mode === "toggle") {
          next = new Set(current);
          for (const id of ids) {
            if (next.has(id)) next.delete(id);
            else next.add(id);
          }
        } else {
          next = new Set(ids);
        }
        viewportRef.current?.setSelection(
          new Set([...next].filter((id) => !id.includes(":")))
        );
        return next;
      });
    },
    []
  );

  // ---- mate authoring --------------------------------------------------
  const disarmMate = useCallback(() => {
    mateDraftRef.current = null;
    setMateDraft(null);
    viewportRef.current?.setConnectorMode(false);
    requestPose(); // restore the evaluated pose after any preview
  }, [requestPose]);

  const armMate = useCallback(
    (schema: MateTypeSchema) => {
      const draft: MateDraft = {
        schema,
        a: null,
        b: null,
        flipPrimaryAxis: false,
        secondaryAxisRotationDeg: 0,
      };
      mateDraftRef.current = draft;
      setMateDraft(draft);
      viewportRef.current?.setConnectorMode(true, (pick) => {
        const current = mateDraftRef.current;
        if (!current) return;
        const connector: ConnectorDTO = {
          part: pick.part,
          origin_m: pick.originM,
          primary_axis: pick.primaryAxis,
          secondary_axis: pick.secondaryAxis,
        };
        const next: MateDraft = current.a
          ? { ...current, b: connector }
          : { ...current, a: connector };
        mateDraftRef.current = next;
        setMateDraft(next);
      });
    },
    []
  );

  const updateDraft = useCallback((draft: MateDraft) => {
    mateDraftRef.current = draft;
    setMateDraft(draft);
  }, []);

  const mateName = useCallback(() => {
    const base = mateDraftRef.current?.schema.type ?? "mate";
    const existing = new Set(rigRef.current?.joints.map((joint) => joint.name));
    let index = 1;
    while (existing.has(`${base}_${index}`)) index += 1;
    return `${base}_${index}`;
  }, []);

  const solveMate = useCallback(async () => {
    const draft = mateDraftRef.current;
    const handle = handleRef.current;
    if (!draft || !handle) return;
    const joint = draftToJoint(draft, mateName());
    if (!joint) return;
    setMateBusy(true);
    try {
      const pose = await previewMate(handle, joint);
      viewportRef.current?.applyPose(pose.parts);
      setStatus(`preview: ${joint.name}`);
      setStatusKind("ok");
    } catch (error) {
      setStatus(`preview failed: ${(error as Error).message}`);
      setStatusKind("warn");
    } finally {
      setMateBusy(false);
    }
  }, [mateName]);

  const commitMate = useCallback(async () => {
    const draft = mateDraftRef.current;
    const handle = handleRef.current;
    if (!draft || !handle) return;
    const joint = draftToJoint(draft, mateName());
    if (!joint) return;
    setMateBusy(true);
    try {
      const result = await addMate(handle, joint);
      handleRef.current = result.handle;
      await adoptRig(result.rig, result.rig);
      disarmMate();
    } catch (error) {
      setStatus(`create mate failed: ${(error as Error).message}`);
      setStatusKind("warn");
    } finally {
      setMateBusy(false);
    }
  }, [adoptRig, disarmMate, mateName]);

  const deleteMate = useCallback(
    async (name: string) => {
      const handle = handleRef.current;
      if (!handle) return;
      try {
        const result = await removeMate(handle, name);
        handleRef.current = result.handle;
        await adoptRig(result.rig, result.rig);
        setSelection(new Set());
      } catch (error) {
        setStatus(`remove mate failed: ${(error as Error).message}`);
        setStatusKind("warn");
      }
    },
    [adoptRig]
  );

  // ---- clips -----------------------------------------------------------
  const chooseClip = useCallback(
    (name: string) => {
      const clip = rigRef.current?.clips.find((entry) => entry.name === name);
      setActiveClip((current) => (current?.name === name ? null : clip ?? null));
      timeRef.current = 0;
      setTimeS(0);
      setPlaying(false);
      requestPose();
    },
    [requestPose]
  );

  // ---- save ------------------------------------------------------------
  const save = useCallback(async () => {
    if (!rawRig) return;
    try {
      if (!autosave.current) return;
      autosave.current.write(JSON.stringify(rawRig));
      await autosave.current.flush();
      if (autosave.current.dirty) await autosave.current.flush();
      setSaveStatus("Saved");
      setStatusKind("ok");
    } catch (error) {
      setStatus(`save failed: ${(error as Error).message}`);
      setStatusKind("warn");
    }
  }, [rawRig]);

  // ---- panels ----------------------------------------------------------
  const partNodes = useMemo<TreeNode[]>(
    () =>
      rig?.parts.map((part) => ({
        id: part.name,
        label: part.name,
        icon: <AetherIcon name="model" />,
        status: part.grounded ? [{ id: "grounded", label: "Grounded", icon: <AetherIcon name="pin_slot" /> }] : undefined,
        dimmed: part.suppressed,
      })) ?? [],
    [rig]
  );
  const mateNodes = useMemo<TreeNode[]>(
    () =>
      rig?.joints.map((joint) => ({
        id: `mate:${joint.name}`,
        label: `${joint.name} · ${joint.type}`,
        icon: <AetherIcon name="mate" />,
      })) ?? [],
    [rig]
  );
  const relationNodes=useMemo<TreeNode[]>(()=>rig?.relations.map(relation=>({id:`relation:${relation.driven}`,label:`${relation.driver} → ${relation.driven}`,icon:<AetherIcon name="link"/>,dimmed:relation.suppressed}))??[],[rig]);
  const selectedRelation=rig?.relations.find(relation=>selection.has(`relation:${relation.driven}`));
  const editRelation=(relation:RelationSummary)=>{const schema=relationSchemas.find(item=>item.kind===relation.kind);if(schema)setRelationDraft({schema,relation});};
  const clipNodes = useMemo<TreeNode[]>(
    () =>
      rig?.clips.map((clip) => ({
        id: `clip:${clip.name}`,
        label: `${clip.name} · ${clip.duration_s.toFixed(2)}s`,
        icon: <AetherIcon name="play" />,
        status: [...(clip.name === activeClip?.name ? [{ id: "active", label: "Active clip", icon: <AetherIcon name="play" /> }] : []), ...(clip.loop ? [{ id: "loop", label: "Looping", icon: <AetherIcon name="redo" /> }] : [])],
      })) ?? [],
    [rig, activeClip]
  );

  const selectedMate = useMemo(() => {
    const id = [...selection].find((entry) => entry.startsWith("mate:"));
    if (!id) return null;
    return rig?.joints.find((joint) => joint.name === id.slice(5)) ?? null;
  }, [selection, rig]);
  const selectedPart = useMemo(() => {
    const id = [...selection].find((entry) => !entry.includes(":"));
    if (!id) return null;
    return rig?.parts.find((part) => part.name === id) ?? null;
  }, [selection, rig]);

  const onDofChange = useCallback(
    (index: number, value: number) => {
      setDofs((current) =>
        current.map((entry, entryIndex) =>
          entryIndex === index ? { ...entry, shown: value, touched: true } : entry
        )
      );
      requestPose();
    },
    [requestPose]
  );
  const onDofReset = useCallback(() => {
    setDofs((current) =>
      current.map((dof) => ({ ...dof, shown: dof.neutral ?? 0, touched: false }))
    );
    requestPose();
  }, [requestPose]);

  const inspector = (
    <Inspector>
      {selectedRelation ? <InspectorSection title="Advanced relation">
        <FieldRow label="Driver"><output>{selectedRelation.driver}</output></FieldRow>
        <FieldRow label="Driven"><output>{selectedRelation.driven}</output></FieldRow>
        <FieldRow label="Ratio"><output>{selectedRelation.ratio}</output></FieldRow>
        <InspectorActions><Button onClick={() => editRelation(selectedRelation)}>Edit relation</Button></InspectorActions>
      </InspectorSection> : selectedMate ? <InspectorSection title={selectedMate.name}>
        <FieldRow label="Type"><output>{selectedMate.type}</output></FieldRow>
        <FieldRow label="Parent"><output>{selectedMate.parent_part}</output></FieldRow>
        <FieldRow label="Child"><output>{selectedMate.child_part}</output></FieldRow>
        <FieldRow label="DOF"><output>{selectedMate.dofs.map(dof => dof.path).join(", ") || "None"}</output></FieldRow>
        <InspectorActions><Button onClick={() => deleteMate(selectedMate.name)}>Remove mate</Button></InspectorActions>
      </InspectorSection> : selectedPart ? <InspectorSection title={selectedPart.name}>
        <FieldRow label="Model"><output>{selectedPart.model || "None"}</output></FieldRow>
        <FieldRow label="Movement"><output>{selectedPart.grounded ? "Grounded" : "Free"}</output></FieldRow>
      </InspectorSection> : <p>Select a part or mate to inspect its properties.</p>}
    </Inspector>
  );

  const characterPanel = (
    <Inspector><InspectorSection title={rig ? rig.identity.display_name ?? rig.identity.name : "Character"}>
      <FieldRow label="Document"><output>{hostFile?.name ?? DEFAULT_CHARACTER}</output></FieldRow>
      {rig ? <>
        <FieldRow label="Parts"><output>{rig.parts.length}</output></FieldRow>
        <FieldRow label="Mates"><output>{rig.joints.length}</output></FieldRow>
        <FieldRow label="Clips"><output>{rig.clips.length}</output></FieldRow>
      </> : <p>Loading…</p>}
      <InspectorActions><Button onClick={boot}>Reload character</Button></InspectorActions>
    </InspectorSection></Inspector>
  );

  const leftPanels: WorkspacePanel[] = [
    {id:'advisor',title:'AI advisor',icon:null,content:<WorkspaceAgent service={studioAgentService} app="animation" contextText={JSON.stringify(rawRig)} detail={hostFile?.name??'Character'} messages={agentMessages} onMessages={setAgentMessages}/>},
    {
      id: "character",
      title: "Character",
      icon: <AetherIcon name="aether" />,
      content: characterPanel,
    },
    {
      id: "parts", collection: true,
      title: "Parts",
      icon: <AetherIcon name="items" />,
      content: (
        <TreePanel ariaLabel="Parts" nodes={partNodes} selectedIDs={selection} onSelect={select} />
      ),
    },
    {
      id: "mates", collection: true,
      title: "Mates",
      icon: <AetherIcon name="mate" />,
      content: (
        <TreePanel ariaLabel="Mates"
          nodes={mateNodes}
          selectedIDs={selection}
          onSelect={select}
          emptyState="no mates — arm a mate tool"
        />
      ),
    },
    {id:"relations",title:"Relations",collection:true,icon:<AetherIcon name="link"/>,content:<TreePanel ariaLabel="Relations" nodes={relationNodes} selectedIDs={selection} onSelect={select} emptyState="No relations — choose a relation in the ribbon."/>},
    {
      id: "clips", collection: true,
      title: "Clips",
      icon: <AetherIcon name="play" />,
      content: (
        <TreePanel ariaLabel="Clips"
          nodes={clipNodes}
          selectedIDs={new Set(activeClip ? [`clip:${activeClip.name}`] : [])}
          onSelect={(ids) => {
            const id = ids[ids.length - 1];
            if (id?.startsWith("clip:")) chooseClip(id.slice(5));
          }}
          emptyState="no clips in this character"
        />
      ),
    },
  ];

  const rightPanels: WorkspacePanel[] = [
    { id: "inspector", title: "Inspector", icon: <AetherIcon name="document" />, content: inspector },
    {
      id: "pose",
      title: "Pose",
      icon: <AetherIcon name="settings" />,
      content: <PosePanel dofs={dofs} onChange={onDofChange} onReset={onDofReset} />,
    },
  ];

  // ---- ribbon ----------------------------------------------------------
  // The shared workspace ribbon draws it; this app only declares what the
  // tools are and what they do (see dev/briefings/tasks/Aether_UI_Consolidation.md).
  const ribbonTabs: WorkspaceRibbonTab[] =
    workspace === "modeling"
      ? [{
          id: "assemble", label: "Assemble",
          groups: [
            { id: "mate", label: "Mate", tools: mateSchemas.map((schema) => ({
              id: `mate:${schema.type}`, label: schema.label,
              icon: <AetherIcon name={TOOL_ICONS[schema.type] ?? "mate"} />,
              active: mateDraft?.schema.type === schema.type,
            })) },
            {id:"relations",label:"Relations",tools:relationSchemas.map(schema=>({id:`relation:${schema.kind}`,label:schema.label,icon:<AetherIcon name="link"/>}))},
            { id: "edit", label: "Edit", tools: [
              { id: "mate-remove", label: "Remove", icon: <AetherIcon name="delete" />, disabled: !selectedMate },
            ] },
          ],
        }]
      : workspace === "animate"
        ? [{ id: "pose", label: "Pose", groups: [
            { id: "pose", label: "Pose", tools: [{ id: "pose-reset", label: "Reset", icon: <AetherIcon name="undo" /> }] },
          ] }]
        : [{ id: "character", label: "Character", groups: [
            { id: "character", label: "Character", tools: [
              { id: "character-reload", label: "Reload", icon: <AetherIcon name="history" /> },
              { id: "character-save", label: "Save", icon: <AetherIcon name="save" /> },
            ] },
          ] }];

  const runCommand = (id: string) => {
    if(id.startsWith("relation:")){const schema=relationSchemas.find(item=>item.kind===id.slice(9));if(schema){disarmMate();setRelationDraft({schema});}return;}
    if (id.startsWith("mate:")) {
      const schema = mateSchemas.find((entry) => entry.type === id.slice("mate:".length));
      if (!schema) return;
      if (mateDraft?.schema.type === schema.type) disarmMate();
      else armMate(schema);
      return;
    }
    if (id === "mate-remove") { if (selectedMate) deleteMate(selectedMate.name); return; }
    if (id === "pose-reset") { onDofReset(); return; }
    if (id === "character-reload") { void boot(); return; }
    if (id === "character-save") void save();
  };

  const toolbar = (
    <WorkspaceRibbon compactTools defaultDensity="compact"
      workspaces={[]}
      workspaceID={workspace}
      onWorkspaceSelect={setWorkspace}
      tabs={ribbonTabs}
      activeTabID={ribbonTabs[0].id}
      onTabSelect={() => {}}
      onCommand={runCommand}
      workspaceLayout="column"
      appearance="glass"
      moreLabel="Toolbar options"
    />
  );

  const fileActions = <MenuButton label="Document controls" items={[{id:'save',label:'Save character',disabled:!rawRig,icon:<AetherIcon name="save"/>},{id:'assets',label:'Character assets',icon:<AetherIcon name="import"/>},{id:'library',label:'Open library',icon:<AetherIcon name="folder"/>}]} onSelect={id=>{if(id==='save')void save();else if(id==='assets')setWorkspace('assets');else documentConnection.openLibrary?.();}}><AetherIcon name="menu"/></MenuButton>;
  // ---- shell -----------------------------------------------------------
  return (
    <div className="app-root aui-studio-app">
      <DocumentBar application={{ apps: applications, id: "animation", name: "Aether Animation" }}
        documentName={rig ? rig.identity.display_name ?? rig.identity.name : "Untitled character"}
        documentState={<StatusDot kind={statusKind} />}
        trailing={
          <>
            <Button onClick={save} disabled={!rawRig}>
              Save
            </Button>
          </>
        }
        viewControls={<><StudioModeButton preset={preset} onChange={choosePreset} /><WorkspaceWindowMenu /></>}
      />
      {relationDraft && rig && <RelationDialog key={relationDraft.relation?.driven??relationDraft.schema.kind} schema={relationDraft.schema} schemas={relationSchemas} relation={relationDraft.relation} rig={rig} onClose={()=>setRelationDraft(null)}
        onApply={async relation=>{const handle=handleRef.current;if(!handle)throw new Error("No character loaded.");const result=await (relationDraft.relation?updateRelation:addRelation)(handle,relation);handleRef.current=result.handle;await adoptRig(result.rig,result.rig);setSelection(new Set([`relation:${relation.driven}`]));}}
        onRemove={relationDraft.relation?async()=>{const handle=handleRef.current;if(!handle)throw new Error("No character loaded.");const result=await removeRelation(handle,relationDraft.relation!.driven);handleRef.current=result.handle;await adoptRig(result.rig,result.rig);setSelection(new Set());}:undefined}/>}
      <WorkspaceShell
        workspaceControls={<WorkspaceSwitcher workspaces={ANIMATION_WORKSPACES} workspaceID={workspace} onSelect={setWorkspace}/>}
        toolPosition={workspace === "animate" ? "top" : "bottom"}
        preset={preset}
        toolbarSpan="center" pinnedPanels={["parts"]}
        preservePanelContent
        storageKey="aether.animation.panels.v1"
        style={{ flex: 1, minHeight: 0 }}
        toolbar={toolbar}
        frameToolbar={false}
        leftPanels={standardWorkspacePanels(leftPanels, { features: "parts" }, documentConnection).filter(panel=>panel.id!=="part-manager")}
        rightPanels={rightPanels}
        defaultOpenLeft={["parts"]}
        defaultOpenRight={["inspector"]}
        bottom={<AnimationFileBar fileActions={fileActions} saveStatus={saveStatus} status={status} connection={documentConnection} parts={rig?.parts.map(part=>part.name)??[]} onSelect={id=>select([id],"single")}/> }
        centerBottom={
          workspace === "animate" ? (
            <TimelinePanel
              clip={activeClip}
              timeS={timeS}
              playing={playing}
              onSeek={(time) => {
                timeRef.current = time;
                setTimeS(time);
                setPlaying(false);
                requestPose();
              }}
              onTogglePlay={() => {
                if (
                  !playing &&
                  activeClip &&
                  timeRef.current >= activeClip.duration_s
                ) {
                  timeRef.current = 0;
                }
                setPlaying((current) => !current);
              }}
            />
          ) : undefined
        }

      >
        <ViewportCanvas
          className="app-viewport"
          onMount={(canvas) => {
            // A failed 3D context must degrade to a dead viewport, never
            // blank the application chrome.
            let viewport: AnimationViewport | null = null;
            try {
              viewport = new AnimationViewport(canvas);
            } catch (error) {
              setStatus(`viewport unavailable: ${(error as Error).message}`);
              setStatusKind("warn");
              return () => {};
            }
            viewport.setPickHandler((name, extend) => {
              if (name) select([name], extend ? "toggle" : "single");
              else {
                setSelection(new Set());
                viewport?.setSelection(new Set());
              }
            });
            viewportRef.current = viewport;
            viewport.setOrientationHandler(setCameraOrientation);
            // The shared shell retains this canvas across layout changes.
            // A fresh mount still hydrates from the active engine projection.
            const current = rigRef.current;
            if (current) {
              void viewport
                .setParts(current.parts, DEFAULT_CHARACTER)
                .then(() => {
                  poseDirty.current = true;
                });
            }
            return () => {
              viewport?.dispose();
              viewportRef.current = null;
            };
          }}
        />
        <div className="animation-view-cube" data-workspace-overlay="top right">
          <ViewportNavigationCube orientation={cameraOrientation}
            onSelectView={(view) => viewportRef.current?.setStandardView(view)}
            onFit={() => viewportRef.current?.fitView()}
            onNudge={(horizontal, vertical) => viewportRef.current?.nudgeView(horizontal, vertical)}
            onRoll={(turns) => viewportRef.current?.rollView(turns)} />
        </div>
        {mateDraft ? (
          <MateDialog
            draft={mateDraft}
            onChange={updateDraft}
            onSolve={() => void solveMate()}
            onCommit={() => void commitMate()}
            onCancel={disarmMate}
            busy={mateBusy}
          />
        ) : null}
      </WorkspaceShell>
    </div>
  );
}
