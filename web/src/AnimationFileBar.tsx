import {useState, type ReactNode} from 'react';
import {AetherIcon, WorkspaceFileBar, NewFileDialog, type DocumentConnection} from '@aether/ui';
import {createNativeFile} from '@aether/session/library/create-native-file';
/** Character lifecycle stays in the app; shared chrome owns the strip and manager. */
export function AnimationFileBar({connection,parts,onSelect,status,saveStatus,fileActions}:{connection:DocumentConnection;parts:string[];onSelect:(id:string)=>void;status:string;saveStatus:string;fileActions?:ReactNode}) {
 const [creating,setCreating]=useState(false);
 return <><WorkspaceFileBar fileActions={fileActions} tabs={[{id:connection.key,label:connection.name,status:saveStatus,icon:<AetherIcon name="file-character"/>}]} activeID={connection.key} onSelect={()=>{}} onAdd={()=>setCreating(true)} addLabel="Create new character" trailing={<span className="aui-workspace-file-status" role="status">{status}</span>}
  manager={{connection,documentGroups:[{id:'parts',label:'Parts',items:parts.map(name=>({id:name,name,kind:'part',detail:'Part'}))}],onOpenItem:item=>onSelect(item.id)}}/>
  {creating&&<NewFileDialog title="New character" directory="My files" onClose={()=>setCreating(false)} onCreate={async name=>{
   if(!connection.openDocument) throw new Error('Connect to Studio to create a library character.');
   await connection.flush();const created=await createNativeFile<{id:string}>('animation','character',name,{scope:'personal',parent:null});
   await connection.openDocument(created.id);setCreating(false);
  }}/>}
 </>;
}
