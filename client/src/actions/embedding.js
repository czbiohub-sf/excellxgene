/*
action creators related to embeddings choice
*/

import { AnnoMatrixObsCrossfilter } from "../annoMatrix";
import { _setEmbeddingSubset, _userSubsetAnnoMatrix } from "../util/stateManager/viewStackHelpers";
import { API } from "../globals";
import { resetSubsetAction } from "./viewStack";
import * as globals from "../globals";

export async function _switchEmbedding(
  prevAnnoMatrix,
  prevCrossfilter,
  oldEmbeddingName,
  newEmbeddingName
) {
  /*
  DRY helper used by this and reembedding action creators
  */
  const base = prevAnnoMatrix.base();
  const embeddingDf = await base.fetch("emb", newEmbeddingName);
  const annoMatrix = _setEmbeddingSubset(prevAnnoMatrix, embeddingDf);
  let obsCrossfilter = await new AnnoMatrixObsCrossfilter(
    annoMatrix,
    prevCrossfilter.obsCrossfilter
  ).dropDimension("emb", oldEmbeddingName);
  obsCrossfilter = await obsCrossfilter.dropDimension("obs", "name_0");
  obsCrossfilter = await obsCrossfilter.select("emb", newEmbeddingName, {
    mode: "all",
  });
  return [annoMatrix, obsCrossfilter];
}

export const requestDeleteEmbedding = (toDelete) => async (
    _dispatch,
    _getState
  ) => {
  
  const res = await fetch(
    `${API.prefix}${API.version}layout/obsm`,
    {
      method: "PUT",
      headers: new Headers({
        Accept: "application/octet-stream",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        embNames: toDelete,
      }),
      credentials: "include",
    }
  );
  const schema = await res.json();

  if (res.ok && res.headers.get("Content-Type").includes("application/json")) {      
    return schema;
  }

  // else an error
  let msg = `Unexpected HTTP response ${res.status}, ${res.statusText}`;
  const body = await res.text();
  if (body && body.length > 0) {
    msg = `${msg} -- ${body}`;
  }
  throw new Error(msg);
}

export const requestRenameEmbedding = (toRename,oldName,newName) => async (
  dispatch,
  getState
) => {
  
dispatch({type: "modifying layouts", modifyingLayouts: true})

const res = await fetch(
  `${API.prefix}${API.version}layout/rename`,
  {
    method: "PUT",
    headers: new Headers({
      Accept: "application/octet-stream",
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      embNames: toRename,
      oldName: oldName,
      newName: newName
    }),
    credentials: "include",
  }
);

let { layoutChoice, annoMatrix } = getState();
const newNames = [];
toRename.forEach((item)=>{
  let newItem;
  if (item.includes(`;;${oldName};;`)) { // middle
    newItem = item.replace(`;;${oldName};;`,`;;${newName};;`)
  } else if (item.includes(`${oldName};;`)) { // root
    newItem = item.replace(`${oldName};;`,`${newName};;`)
  } else if (item.includes(`;;${oldName}`)) { // leaf
    newItem = item.replace(`;;${oldName}`,`;;${newName}`)    
  } else if (item === oldName) { // no children
    newItem = newName;
  }
  if (annoMatrix.viewOf) {
    delete annoMatrix.viewOf.schema.layout.obsByName[item];
    annoMatrix.viewOf.schema.layout.obsByName[newItem] = {dims: [`${newItem}_0`,`${newItem}_1`], name: newItem, type: "float32"}    

    const layouts = [];
    Object.keys(annoMatrix.viewOf.schema.layout.obsByName).forEach((item)=>{
      layouts.push(annoMatrix.viewOf.schema.layout.obsByName[item])
    })
    annoMatrix.viewOf.schema.layout.obs = layouts;    

  }
  delete annoMatrix.schema.layout.obsByName[item]
  annoMatrix.schema.layout.obsByName[newItem] = {dims: [`${newItem}_0`,`${newItem}_1`], name: newItem, type: "float32"}
  
  const layouts = [];
  Object.keys(annoMatrix.schema.layout.obsByName).forEach((item)=>{
    layouts.push(annoMatrix.schema.layout.obsByName[item])
  })
  annoMatrix.schema.layout.obs = layouts;

  newNames.push(newItem);
})    
const item = layoutChoice.current;
let newCurrent;
if (item.includes(`;;${oldName};;`)) { // middle
  newCurrent = item.replace(`;;${oldName};;`,`;;${newName};;`)
} else if (item.includes(`${oldName};;`)) { // root
  newCurrent = item.replace(`${oldName};;`,`${newName};;`)
} else if (item.includes(`;;${oldName}`)) { // leaf
  newCurrent = item.replace(`;;${oldName}`,`;;${newName}`)    
} else if (item === oldName) { // no children
  newCurrent = newName;
} else {
  newCurrent = item;
}
toRename.forEach((item,index)=>{
  dispatch({type: "reembed: rename reembedding", embName: item, newName: newNames[index]});
})
await dispatch(layoutChoiceAction(newCurrent)); 
dispatch({type: "modifying layouts", modifyingLayouts: false})

if (res.ok && res.headers.get("Content-Type").includes("application/json")) {      
  return true;
}

// else an error
let msg = `Unexpected HTTP response ${res.status}, ${res.statusText}`;
const body = await res.text();
if (body && body.length > 0) {
  msg = `${msg} -- ${body}`;
}
throw new Error(msg);
}

export const layoutChoiceAction = (newLayoutChoice) => async (
  dispatch,
  getState
) => {
  /*
  On layout choice, make sure we have selected all on the previous layout, AND the new
  layout.
  */
  const {
    annoMatrix: prevAnnoMatrix,
    obsCrossfilter: prevCrossfilter,
    layoutChoice,
  } = getState();  
  dispatch({
    type: "reset subset"
  })  
  let [annoMatrix, obsCrossfilter] = await _switchEmbedding(
    prevAnnoMatrix,
    prevCrossfilter,
    layoutChoice.current,
    newLayoutChoice
  );
  
  [annoMatrix, obsCrossfilter] = dispatch(resetSubsetAction({annoMatrix}))
  
  dispatch({
    type: "set layout choice",
    layoutChoice: newLayoutChoice,
    obsCrossfilter,
    annoMatrix,
  });
  dispatch({type: "refresh var metadata"}) 
};
