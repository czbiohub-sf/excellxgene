import * as globals from "../globals";
import { API } from "../globals";
import { AnnoMatrixLoader, AnnoMatrixObsCrossfilter } from "../annoMatrix";
import {
  catchErrorsWrap,
  doJsonRequest,
  dispatchNetworkErrorMessageToUser,
} from "../util/actionHelpers";
import {
  requestReembed, requestPreprocessing
} from "./reembed";
import {
  requestSankey
} from "./sankey";
import {
  requestLeiden
} from "./leiden";
import {
  postNetworkErrorToast,
  postAsyncSuccessToast,
  postAsyncFailureToast,
} from "../components/framework/toasters";
import { loadUserColorConfig } from "../util/stateManager/colorHelpers";
import * as selnActions from "./selection";
import * as annoActions from "./annotation";
import * as viewActions from "./viewStack";
import * as embActions from "./embedding";
import * as genesetActions from "./geneset";
import { defaultReembedParams } from "../reducers/reembed";
import { _switchEmbedding } from "./embedding";
/*
return promise fetching user-configured colors
*/
async function userColorsFetchAndLoad(dispatch) {
  return fetchJson("colors").then((response) =>
    dispatch({
      type: "universe: user color load success",
      userColors: loadUserColorConfig(response),
    })
  );
}

async function schemaFetch() {
  return fetchJson("schema");
}

async function configFetch(dispatch) {
  return fetchJson("config").then((response) => {
    const config = { ...globals.configDefaults, ...response.config };
    dispatch({
      type: "configuration load complete",
      config,
    });
    return config;
  });
}

export async function userInfoFetch(dispatch) {
  return fetchJson("userinfo").then((response) => {
    const { userinfo: userInfo } = response || {};
    dispatch({
      type: "userInfo load complete",
      userInfo,
    });
    return userInfo;
  });
}

async function genesetsFetch(dispatch, config) {
  /* request genesets ONLY if the backend supports the feature */
  const defaultResponse = {
    genesets: [],
    tid: 0,
  };
  if (config?.parameters?.annotations_genesets ?? false) {
    fetchJson("genesets").then((response) => {
      dispatch({
        type: "geneset: initial load",
        data: response ?? defaultResponse,
      });
    });
  } else {
    dispatch({
      type: "geneset: initial load",
      data: defaultResponse,
    });
  }
}
export async function reembedParamsFetch(dispatch) {
  /* request reembedding parameters ONLY if the backend supports the feature */
  const defaultResponse = {
    reembedParams: defaultReembedParams,
  };
  try {
    fetchJson("reembed-parameters").then((response) => {
      const isEmpty = Object.keys(response.reembedParams).length === 0;
      dispatch({
        type: "reembed: load",
        params: isEmpty
          ? defaultResponse.reembedParams
          : response.reembedParams ?? defaultResponse.reembedParams,
      });
    });
  } catch (e) {
    dispatch({
      type: "reembed: load",
      data: defaultResponse,
    });
  }
}
export const reembedParamsObsmFetch = (embName) => async (
  dispatch,
  _getState
) => {
  const defaultResponse = defaultReembedParams;
  const res = await fetch(
    `${API.prefix}${API.version}reembed-parameters-obsm`,
    {
      method: "PUT",
      headers: new Headers({
        Accept: "application/octet-stream",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        embName: embName
      }),
      credentials: "include",
    },
  );
  const response = await res.json();

  const isEmpty = Object.keys(response.reembedParams).length === 0;
  if (!isEmpty){
    dispatch({
      type: "reembed: load",
      params: response.reembedParams,
    }); 
  }
}


function prefetchEmbeddings(annoMatrix) {
  /*
  prefetch requests for all embeddings
  */
  const { schema } = annoMatrix;
  const available = schema.layout.obs.map((v) => v.name);
  available.forEach((embName) => annoMatrix.prefetch("emb", embName));
}

function abortableFetch(request, opts, timeout = 0) {
  const controller = new AbortController();
  const { signal } = controller;

  return {
    abort: () => controller.abort(),
    isAborted: () => signal.aborted,
    ready: () => {
      if (timeout) {
        setTimeout(() => controller.abort(), timeout);
      }
      return fetch(request, { ...opts, signal });
    },
  };
}
export const requestSaveAnndataToFile = (saveName) => async (
  dispatch,
  getState
) => {
  try{
    const state = getState();
    const { annoMatrix, layoutChoice } = state;
    
    let cells = annoMatrix.rowIndex.labels();  
    cells = Array.isArray(cells) ? cells : Array.from(cells);

    const annos = []
    const annoNames = []
    
    for (const item of annoMatrix.schema.annotations?.obs?.columns) {
      if(item?.categories){
        let labels = await annoMatrix.fetch("obs",item.name)
        annos.push(labels)
        annoNames.push(item.name)
      }
    }
    const af = abortableFetch(
      `${API.prefix}${API.version}output`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          saveName: saveName,
          labelNames: annoNames,
          labels: annos,
          currentLayout: layoutChoice.current,
          filter: { obs: { index: cells } }
        }),
        credentials: "include",
      },
      6000000
    );
    dispatch({
      type: "output data: request start",
      abortableFetch: af,
    });
    const res = await af.ready();
    postAsyncSuccessToast("Data has been successfully saved.");
    dispatch({
      type: "output data: request completed",
    });
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
  } catch (error) {
    dispatch({
      type: "ouput data: request aborted",
    });
    if (error.name === "AbortError") {
      postAsyncFailureToast("Data output was aborted.");
    } else {
      postNetworkErrorToast(`Data output: ${error.message}`);
    }
  }
}
export function requestDataLayerChange(dataLayer) {
  return async (_dispatch, _getState) => {
    const res = await fetch(
      `${API.prefix}${API.version}layer`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          dataLayer: dataLayer,
        }),
        credentials: "include",
        }
    );
    if (res.ok && res.headers.get("Content-Type").includes("application/json")) {
      return res;
    }
  }
}
export function requestReloadBackend() {
  return async (dispatch, getState) => {
    try{
      const { annoMatrix, layoutChoice } = getState()

      let cells = annoMatrix.rowIndex.labels();  
      cells = Array.isArray(cells) ? cells : Array.from(cells);

      const af = abortableFetch(
        `${API.prefix}${API.version}reload`,
        {
          method: "PUT",
          headers: new Headers({
            Accept: "application/octet-stream",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            currentLayout: layoutChoice.current,
            filter: { obs: { index: cells } }
          }),        
          credentials: "include",
          },
          6000000
      );
      dispatch({
        type: "output data: request start",
        abortableFetch: af,
      });
      const res = await af.ready();      
      
      dispatch({
        type: "app: refresh"
      })

      dispatch({
        type: "output data: request completed",
      });

      postAsyncSuccessToast("Data has successfuly overwritten the backend.");

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
    } catch (error) {
      dispatch({
        type: "ouput data: request aborted",
      });
      if (error.name === "AbortError") {
        postAsyncFailureToast("Data output was aborted.");
      } else {
        postNetworkErrorToast(`Data output: ${error.message}`);
      }
    }
  }
}

export function requestReloadFullBackend() {
  return async (dispatch, _getState) => {
    try{
      const af = abortableFetch(
        `${API.prefix}${API.version}reloadFull`,
        {
          method: "PUT",
          headers: new Headers({
            Accept: "application/octet-stream",
            "Content-Type": "application/json",
          }),     
          credentials: "include",
          },
          6000000
      );
      dispatch({
        type: "output data: request start",
        abortableFetch: af,
      });
      const res = await af.ready();      
      
      dispatch({
        type: "app: refresh"
      })

      dispatch({
        type: "output data: request completed",
      });

      postAsyncSuccessToast("Data has successfuly overwritten the backend.");

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
    } catch (error) {
      dispatch({
        type: "ouput data: request aborted",
      });
      if (error.name === "AbortError") {
        postAsyncFailureToast("Data output was aborted.");
      } else {
        postNetworkErrorToast(`Data output: ${error.message}`);
      }
    }
  }
}

const setupWebSockets = (dispatch,getState) => {
  const onMessage = (event) => {
    const data = JSON.parse(event.data)

    if (data.cfn === "diffexp"){
      const { annoMatrix, genesets } = getState();
      const { diffExpListsLists } = genesets;
      const n = data?.nameList?.length-1 ?? -1
      const varIndexName = annoMatrix.schema.annotations.var.index;

      annoMatrix.fetch("var", varIndexName).then((varIndex)=>{
        const diffexpLists = { negative: [], positive: [] };
        for (const polarity of Object.keys(diffexpLists)) {
          diffexpLists[polarity] = data.response[polarity].map((v) => [
            varIndex.at(v[0], varIndexName),
            ...v.slice(1),
          ]);
        }
        if (!data?.multiplex) {
          dispatch({
            type: "request differential expression success",
            data: diffexpLists,
          });      
        } else if (data?.multiplex && (diffExpListsLists.length+1) === n) {
          diffExpListsLists.push(diffexpLists)
          dispatch({
            type: "request differential expression all success",
            dataList: diffExpListsLists,
            nameList: data.nameList,
            dateString: new Date().toLocaleString(),
            grouping: data.grouping,
          });    
          dispatch({type: "request differential expression all completed"})      
        } else {
          dispatch({
            type: "request differential expression push list",
            data: diffexpLists,
          });              
        }
      });  
    }
  }   
  const wsDiffExp = new WebSocket(`ws://${globals.API.prefix.split('/api').at(0).split('://').at(-1)}/diffexp`)
  wsDiffExp.onmessage = onMessage

  dispatch({type: "init: set up websockets",ws: wsDiffExp, name: "wsDiffExp"})
}

const doInitialDataLoad = () =>
  catchErrorsWrap(async (dispatch, getState) => {
    dispatch({ type: "initial data load start" });
    
    try {
      const [config, schema] = await Promise.all([
        configFetch(dispatch),
        schemaFetch(dispatch),
        userColorsFetchAndLoad(dispatch),
        userInfoFetch(dispatch),
      ]);
      genesetsFetch(dispatch, config);
      reembedParamsFetch(dispatch);
      
      await dispatch(requestDataLayerChange("X"));
      const baseDataUrl = `${globals.API.prefix}${globals.API.version}`;   
      
      const annoMatrix = new AnnoMatrixLoader(baseDataUrl, schema.schema);
      const obsCrossfilter = new AnnoMatrixObsCrossfilter(annoMatrix);
      prefetchEmbeddings(annoMatrix);
      const allGenes = await annoMatrix.fetch("var","name_0")
      const layoutSchema = schema?.schema?.layout?.obs ?? [];
      if(layoutSchema.length > 0){
        const name = layoutSchema[0].name
        const base = annoMatrix.base();

        const [annoMatrixNew, obsCrossfilterNew] = await _switchEmbedding(
          base,
          obsCrossfilter,
          name,
          name
        ); 
        dispatch({
          type: "annoMatrix: init complete",
          annoMatrix: annoMatrixNew,
          obsCrossfilter: obsCrossfilterNew
        });        
        
      } else { 
        dispatch({
          type: "annoMatrix: init complete",
          annoMatrix,
          obsCrossfilter
        });
      }

      dispatch({ type: "initial data load complete", allGenes});

      const defaultEmbedding = config?.parameters?.default_embedding;
      if (
        defaultEmbedding &&
        layoutSchema.some((s) => s.name === defaultEmbedding)
      ) {
        dispatch(embActions.layoutChoiceAction(defaultEmbedding));
      }

      setupWebSockets(dispatch,getState)      

    } catch (error) {
      dispatch({ type: "initial data load error", error });
    }
  }, true);

function requestSingleGeneExpressionCountsForColoringPOST(gene) {
  return {
    type: "color by expression",
    gene,
  };
}

const requestUserDefinedGene = (gene) => ({
  type: "request user defined gene success",
  data: {
    genes: [gene],
  },
});

const dispatchDiffExpErrors = (dispatch, response) => {
  switch (response.status) {
    case 403:
      dispatchNetworkErrorMessageToUser(
        "Too many cells selected for differential experesion calculation - please make a smaller selection."
      );
      break;
    case 501:
      dispatchNetworkErrorMessageToUser(
        "Differential expression is not implemented."
      );
      break;
    default: {
      const msg = `Unexpected differential expression HTTP response ${response.status}, ${response.statusText}`;
      dispatchNetworkErrorMessageToUser(msg);
      dispatch({
        type: "request differential expression error",
        error: new Error(msg),
      });
    }
  }
};

const requestDifferentialExpression = (set1, set2, num_genes = 100) => async (
  dispatch,
  getState
) => {
  try{
    dispatch({ type: "request differential expression started" });
  
    const { controls } = getState();
    const { wsDiffExp } = controls;

    if (!set1) set1 = [];
    if (!set2) set2 = [];
    set1 = Array.isArray(set1) ? set1 : Array.from(set1);
    set2 = Array.isArray(set2) ? set2 : Array.from(set2);
    wsDiffExp.send(JSON.stringify({
      mode: "topN",
      count: num_genes,
      set1: { filter: { obs: { index: set1 } } },
      set2: { filter: { obs: { index: set2 } } },
      multiplex: false
    }))
  } catch (error) {
    return dispatch({
      type: "request differential expression error",
      error,
    });
  }
}

const requestDifferentialExpressionAll = (num_genes = 100) => async (
  dispatch,
  getState
) => {
  dispatch({ type: "request differential expression all started" });

  try {
    /*
    Steps:
    1. for each category,
    2. get the most differentially expressed genes
    3. get expression data for each
    */
    const { annoMatrix, sankeySelection, controls } = getState();
    const { categories } = sankeySelection;
    const { wsDiffExp } = controls;

    let labels;
    let categoryName;
    for (const [key, value] of Object.entries(categories)) {
      if(value){
        labels = await annoMatrix.fetch("obs",key)
        categoryName = key;
      }
    }    
    labels = labels.__columns[0];
    const allCategories = annoMatrix.schema.annotations.obsByName[categoryName].categories
    for ( const cat of allCategories ) {
      if (cat !== "unassigned"){
        let set1 = []
        let set2 = []
        for (let i = 0; i < labels.length; i++){
          if(labels[i] === cat){
            set1.push(i)
          } else {
            set2.push(i)
          }
        }
        set1 = Array.isArray(set1) ? set1 : Array.from(set1);
        set2 = Array.isArray(set2) ? set2 : Array.from(set2);
        wsDiffExp.send(JSON.stringify({
          mode: "topN",
          count: num_genes,
          set1: { filter: { obs: { index: set1 } } },
          set2: { filter: { obs: { index: set2 } } },
          multiplex: true,
          grouping: categoryName,
          nameList: allCategories
        }))
      } 
    }
  } catch (error) {
    return dispatch({
      type: "request differential expression error",
      error,
    });
  }
};
const selectAll = () => async (dispatch, getState) => {
  dispatch({ type: "select all observations" });
  try {
    const { obsCrossfilter: prevObsCrossfilter } = getState();
    const obsCrossfilter = await prevObsCrossfilter.selectAll();
    return dispatch({
      type: "selected all observations",
      obsCrossfilter,
    });
  } catch (error) {
    return dispatch({
      type: "error selecting all observations",
      error,
    });
  }
};

function fetchJson(pathAndQuery) {
  return doJsonRequest(
    `${globals.API.prefix}${globals.API.version}${pathAndQuery}`
  );
}

export default {
  prefetchEmbeddings,
  reembedParamsObsmFetch,
  requestDifferentialExpressionAll,
  doInitialDataLoad,
  requestDataLayerChange,
  requestReloadBackend,
  requestReloadFullBackend,
  selectAll,
  requestDifferentialExpression,
  requestSingleGeneExpressionCountsForColoringPOST,
  requestUserDefinedGene,
  requestReembed,
  requestPreprocessing,
  requestSankey,
  requestLeiden,
  requestSaveAnndataToFile,
  setCellsFromSelectionAndInverseAction:
    selnActions.setCellsFromSelectionAndInverseAction,
  selectContinuousMetadataAction: selnActions.selectContinuousMetadataAction,
  selectCategoricalMetadataAction: selnActions.selectCategoricalMetadataAction,
  selectCategoricalAllMetadataAction:
    selnActions.selectCategoricalAllMetadataAction,
  graphBrushStartAction: selnActions.graphBrushStartAction,
  graphBrushChangeAction: selnActions.graphBrushChangeAction,
  graphBrushDeselectAction: selnActions.graphBrushDeselectAction,
  graphBrushCancelAction: selnActions.graphBrushCancelAction,
  graphBrushEndAction: selnActions.graphBrushEndAction,
  graphLassoStartAction: selnActions.graphLassoStartAction,
  graphLassoEndAction: selnActions.graphLassoEndAction,
  graphLassoCancelAction: selnActions.graphLassoCancelAction,
  graphLassoDeselectAction: selnActions.graphLassoDeselectAction,
  clipAction: viewActions.clipAction,
  subsetAction: viewActions.subsetAction,
  resetSubsetAction: viewActions.resetSubsetAction,
  annotationCreateCategoryAction: annoActions.annotationCreateCategoryAction,
  annotationRenameCategoryAction: annoActions.annotationRenameCategoryAction,
  annotationDeleteCategoryAction: annoActions.annotationDeleteCategoryAction,
  annotationCreateLabelInCategory: annoActions.annotationCreateLabelInCategory,
  requestFuseLabels: annoActions.requestFuseLabels,
  requestDeleteLabels: annoActions.requestDeleteLabels,
  annotationDeleteLabelFromCategory:
    annoActions.annotationDeleteLabelFromCategory,
  annotationRenameLabelInCategory: annoActions.annotationRenameLabelInCategory,
  annotationLabelCurrentSelection: annoActions.annotationLabelCurrentSelection,
  saveObsAnnotationsAction: annoActions.saveObsAnnotationsAction,
  saveGenesetsAction: annoActions.saveGenesetsAction,
  saveReembedParametersAction: annoActions.saveReembedParametersAction,
  needToSaveObsAnnotations: annoActions.needToSaveObsAnnotations,
  layoutChoiceAction: embActions.layoutChoiceAction,
  requestDeleteEmbedding: embActions.requestDeleteEmbedding,
  requestRenameEmbedding: embActions.requestRenameEmbedding,
  setCellSetFromSelection: selnActions.setCellSetFromSelection,
  setCellSetFromInputArray: selnActions.setCellSetFromInputArray,
  genesetDelete: genesetActions.genesetDelete,
  genesetDeleteGroup: genesetActions.genesetDeleteGroup,
  genesetAddGenes: genesetActions.genesetAddGenes,
  genesetDeleteGenes: genesetActions.genesetDeleteGenes,
};
