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
import { Dataframe } from "../util/dataframe";

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
async function userInfoAuth0Fetch() {
  return fetchJson("userInfo");
}
async function hostedModeFetch() {
  return fetchJson("hostedMode");
}
async function initializeFetch() {
  return fetchJson("initialize");
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
  getState
) => {
  const { controls } = getState();
  const { username } = controls;
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

export const downloadData = () => async (
  dispatch,
  getState
) => {

    const state = getState();
    const { annoMatrix, layoutChoice, controls } = state;
    const { wsDownloadAnndata } = controls;
    
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
    wsDownloadAnndata.send(JSON.stringify({
      labelNames: annoNames,
      labels: annos,
      currentLayout: layoutChoice.current,
      filter: { obs: { index: cells } }
    }))

    dispatch({
      type: "output data: request start"
    });    
}

export const downloadMetadata = () => async (
  _dispatch,
  getState
) => {
    const state = getState();
    // get current embedding
    const { layoutChoice, sankeySelection, annoMatrix, controls } = state;
    const { selectedCategories } = sankeySelection;

    let catNames;
    if (selectedCategories.length === 0) {
      catNames = [];
      for (const item of annoMatrix.schema.annotations?.obs?.columns) {
        if(item?.categories){
          if (item.name !== "name_0"){
            catNames.push(item.name)
          }
        }
      }      
    } else {
      catNames = selectedCategories;
    }
    let cells = annoMatrix.rowIndex.labels();  
    cells = Array.isArray(cells) ? cells : Array.from(cells);

    const res = await fetch(
      `${API.prefix}${API.version}downloadMetadata`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          labelNames: catNames,
          filter: { obs: { index: cells } }
        }),
        credentials: "include",
        }
    );

    const blob = await res.blob()

    var a = document.createElement("a");
    document.body.appendChild(a);
    a.style = "display: none";

    var url = window.URL.createObjectURL(blob);
    a.href = url;
    a.download = `${layoutChoice.current}_obs.csv`.split(";").join("_");
    a.click();
    window.URL.revokeObjectURL(url);
}

export const requestSaveAnndataToFile = (saveName) => async (
  dispatch,
  getState
) => {
  try{
    const state = getState();
    const { annoMatrix, layoutChoice, controls } = state;
    
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

const setupWebSockets = (dispatch,getState,loggedIn,hostedMode) => {

  const onMessage = async (event) => {
    const data = JSON.parse(event.data);
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
    } else if (data.cfn === "reembedding"){
      const schema = data.response;
      dispatch({
        type: "reembed: request completed",
      });
      const {
        annoMatrix: prevAnnoMatrix,
        obsCrossfilter: prevCrossfilter,
        layoutChoice,
      } = getState();
      const base = prevAnnoMatrix.base().addEmbedding(schema);
      dispatch({
        type: "reset subset"
      })
      const [annoMatrix, obsCrossfilter] = await _switchEmbedding(
        base,
        prevCrossfilter,
        layoutChoice.current,
        schema.name
      );
      dispatch({
        type: "reembed: add reembedding",
        schema,
        annoMatrix,
        obsCrossfilter,
      });
      postAsyncSuccessToast("Re-embedding has completed.");

    /*} else if (data.cfn === "preprocessing"){
      const {        
        obsCrossfilter: prevCrossfilter,
        layoutChoice,
        annoMatrix: dummy
      } = getState();

      const schema = dummy.schema;

      dispatch({
        type: "preprocess: request completed",
      });

      const baseDataUrl = `${API.prefix}${API.version}`;
      const annoMatrixNew = new AnnoMatrixLoader(baseDataUrl, schema);
      prefetchEmbeddings(annoMatrixNew);

      dispatch({
        type: "reset subset"
      })

      const [annoMatrix, obsCrossfilter] = await _switchEmbedding(
        annoMatrixNew,
        prevCrossfilter,
        layoutChoice.current,
        layoutChoice.current
      );
      
      dispatch({
        type: "annoMatrix: init complete",
        annoMatrix,
        obsCrossfilter
      });      
      postAsyncSuccessToast("Preprocessing has completed.");
    } */ 
    } else if (data.cfn === "sankey"){
      const { layoutChoice } = getState();
      const catNames = data.catNames;
      const sankey = data.response;
      const threshold = data.threshold;
      dispatch({
        type: "sankey: request completed",
      });
      dispatch({
        type: "sankey: cache results",
        sankey,
        key: `${catNames.join(";")}_${layoutChoice.current}`
      })
      const links = []
      const nodes = []
      let n = []
      sankey.edges.forEach(function (item, index) {
        if (sankey.weights[index] > threshold && item[0].split('_').slice(1).join('_') !== "unassigned" && item[1].split('_').slice(1).join('_') !== "unassigned"){
          links.push({
            source: item[0],
            target: item[1],
            value: sankey.weights[index]
          })
          n.push(item[0])
          n.push(item[1])
        }
      });   
      n = n.filter((item, i, ar) => ar.indexOf(item) === i);

      n.forEach(function (item){
        nodes.push({
          id: item
        })
      })
      const d = {links: links, nodes: nodes}
      dispatch({type: "sankey: set data",data: d})
    } else if (data.cfn === "leiden"){
      const { obsCrossfilter: prevObsCF } = getState();
      const val = data.response;
      const name = data.cName;
      dispatch({
        type: "leiden: request completed",
      });

      let prevObsCrossfilter;
      if (prevObsCF.annoMatrix.schema.annotations.obsByName[name]) {
        prevObsCrossfilter = prevObsCF.dropObsColumn(name);
      } else {
        prevObsCrossfilter = prevObsCF;
      }
      const initialValue = new Array(val);
      const df = new Dataframe([initialValue[0].length,1],initialValue)
      const { categories } = df.col(0).summarizeCategorical();
      if (!categories.includes(globals.unassignedCategoryLabel)) {
        categories.push(globals.unassignedCategoryLabel);
      }
      const ctor = initialValue.constructor;
      const newSchema = {
        name: name,
        type: "categorical",
        categories,
        writable: true,
      };     
      const arr = new Array(prevObsCrossfilter.annoMatrix.schema.dataframe.nObs).fill("unassigned");
      const index = prevObsCrossfilter.annoMatrix.rowIndex.labels()
      for (let i = 0; i < index.length; i++) {
        arr[index[i]] = val[i] ?? "what"
      }
      const obsCrossfilter = prevObsCrossfilter.addObsColumn(
        newSchema,
        ctor,
        arr
      );         
      dispatch({
        type: "annotation: create category",
        data: name,
        categoryToDuplicate: null,
        annoMatrix: obsCrossfilter.annoMatrix,
        obsCrossfilter,
      });       
    } else if (data.cfn === "downloadAnndata"){
      const { layoutChoice } = getState();
      const res = await fetch(`${API.prefix}${API.version}sendFile?path=${data.response}`,
            {
              headers: new Headers({
                "Content-Type": "application/octet-stream",
              }),
              credentials: "include",
            })
      const blob = await res.blob()
  
      var a = document.createElement("a");
      document.body.appendChild(a);
      a.style = "display: none";
  
      var url = window.URL.createObjectURL(blob);
      a.href = url;
      a.download = `${layoutChoice.current}.h5ad`.split(";").join("_");
      a.click();
      window.URL.revokeObjectURL(url);
  
      dispatch({
        type: "output data: request completed",
      });    
    }
  }   
  let wsDiffExp;
  let wsReembedding;
  let wsSankey;
  let wsLeiden;
  let wsDownloadAnndata;
  try{
    if (loggedIn || !hostedMode){
      wsDiffExp = new WebSocket(`ws://${globals.API.prefix.split('/api').at(0).split('://').at(-1)}/diffexp`)
      wsDiffExp.onmessage = onMessage
      dispatch({type: "init: set up websockets",ws: wsDiffExp, name: "wsDiffExp"})    
    }
  } catch (e) {}
  try{
    if (loggedIn || !hostedMode){
      wsReembedding = new WebSocket(`ws://${globals.API.prefix.split('/api').at(0).split('://').at(-1)}/reembedding`)
      wsReembedding.onmessage = onMessage
      dispatch({type: "init: set up websockets",ws: wsReembedding, name: "wsReembedding"})
    }
  } catch (e) {}
  /*try{
    if (!hostedMode){
      const wsPreprocessing = new WebSocket(`ws://${globals.API.prefix.split('/api').at(0).split('://').at(-1)}/preprocessing`)
      wsPreprocessing.onmessage = onMessage
      dispatch({type: "init: set up websockets",ws: wsPreprocessing, name: "wsPreprocessing"})
    }
  } catch (e) {}*/
  try{
    if (loggedIn || !hostedMode){
      wsSankey = new WebSocket(`ws://${globals.API.prefix.split('/api').at(0).split('://').at(-1)}/sankey`)
      wsSankey.onmessage = onMessage
      dispatch({type: "init: set up websockets",ws: wsSankey, name: "wsSankey"})
    }
  } catch (e) {}
  try{
    if (loggedIn || !hostedMode){
      wsLeiden = new WebSocket(`ws://${globals.API.prefix.split('/api').at(0).split('://').at(-1)}/leiden`)
      wsLeiden.onmessage = onMessage
      dispatch({type: "init: set up websockets",ws: wsLeiden, name: "wsLeiden"})
    }
  } catch (e) {}
  try{
    if (loggedIn || !hostedMode){
      wsDownloadAnndata = new WebSocket(`ws://${globals.API.prefix.split('/api').at(0).split('://').at(-1)}/downloadAnndata`)
      wsDownloadAnndata.onmessage = onMessage
      dispatch({type: "init: set up websockets",ws: wsDownloadAnndata, name: "wsDownloadAnndata"})
    }
  } catch (e) {}
  if (loggedIn || !hostedMode) {
    window.onbeforeunload = function() {
      wsDiffExp.onclose = function () {};
      wsDiffExp.close();
  
      wsReembedding.onclose = function () {};
      wsReembedding.close();
      
      wsSankey.onclose = function () {};
      wsSankey.close();
      
      wsLeiden.onclose = function () {};
      wsLeiden.close();
      
      wsDownloadAnndata.onclose = function () {};
      wsDownloadAnndata.close(); 
    };  
  }
}

const doInitialDataLoad = () =>
  catchErrorsWrap(async (dispatch, getState) => {
    dispatch({ type: "initial data load start" });
    await initializeFetch(dispatch);
    try {
      const [config, schema, res, res2] = await Promise.all([
        configFetch(dispatch),
        schemaFetch(dispatch),
        userInfoAuth0Fetch(dispatch),
        hostedModeFetch(dispatch),
        userColorsFetchAndLoad(dispatch),
        userInfoFetch(dispatch),
      ]);
      genesetsFetch(dispatch, config);
      reembedParamsFetch(dispatch);
      const { response: userInfo } = res;
      const { response: hostedMode } = res2;
      if ( hostedMode ) {
        dispatch({type: "set user info", userInfo})
      } else {
        dispatch({type: "set user info", userInfo: {desktopMode: true}})
      }
      
      dispatch({type: "set hosted mode", hostedMode})
      const baseDataUrl = `${globals.API.prefix}${globals.API.version}`;   
      
      const annoMatrix = new AnnoMatrixLoader(baseDataUrl, schema.schema);
      const obsCrossfilter = new AnnoMatrixObsCrossfilter(annoMatrix);
      prefetchEmbeddings(annoMatrix);
      const allGenes = await annoMatrix.fetch("var","name_0")
      const layoutSchema = schema?.schema?.layout?.obs ?? [];
      if(layoutSchema.length > 0){
        const preferredNames = ["root","umap", "tsne", "pca"];
        const f = layoutSchema.filter((i) => {
          return preferredNames.includes(i.name)
        })
        let name;
        if (f.length > 0) {
          name = f[0].name
        } else {
          name = layoutSchema[0].name
        }
        const base = annoMatrix.base();

        const [annoMatrixNew, obsCrossfilterNew] = await _switchEmbedding(
          base,
          obsCrossfilter,
          name,
          name
        ); 
        prefetchEmbeddings(annoMatrixNew);

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

      setupWebSockets(dispatch,getState,userInfo ? true : false, hostedMode)      

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
  
    const { annoMatrix, controls } = getState();
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
      multiplex: false,
      layer: annoMatrix.layer
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
    const ix = annoMatrix.rowIndex.labels()
    const allCategories = annoMatrix.schema.annotations.obsByName[categoryName].categories
    for ( const cat of allCategories ) {
      if (cat !== "unassigned"){
        let set1 = []
        let set2 = []
        for (let i = 0; i < labels.length; i++){
          if(labels[i] === cat){
            set1.push(ix[i])
          } else {
            set2.push(ix[i])
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
          nameList: allCategories,
          layer: annoMatrix.layer
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
  selectAll,
  requestDifferentialExpression,
  requestSingleGeneExpressionCountsForColoringPOST,
  requestUserDefinedGene,
  requestReembed,
  requestPreprocessing,
  requestSankey,
  requestLeiden,
  downloadData,
  downloadMetadata,
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
