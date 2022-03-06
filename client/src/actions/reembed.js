import { API } from "../globals";

import {
  postNetworkErrorToast,
  postAsyncSuccessToast,
  postAsyncFailureToast,
} from "../components/framework/toasters";
import { _switchEmbedding } from "./embedding";
import { subsetAction } from "./viewStack";
import { AnnoMatrixLoader } from "../annoMatrix";
import actions from ".";

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

async function doReembedFetch(dispatch, getState, reembedParams,parentName,embName) {
  const state = getState();
  let cells = state.annoMatrix.rowIndex.labels();
  // These lines ensure that we convert any TypedArray to an Array.
  // This is necessary because JSON.stringify() does some very strange
  // things with TypedArrays (they are marshalled to JSON objects, rather
  // than being marshalled as a JSON array).
  cells = Array.isArray(cells) ? cells : Array.from(cells);
  const af = abortableFetch(
    `${API.prefix}${API.version}layout/obs`,
    {
      method: "PUT",
      headers: new Headers({
        Accept: "application/octet-stream",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        method: "umap",
        filter: { obs: { index: cells } },
        params: reembedParams,
        parentName: parentName,
        embName: embName,
      }),
      credentials: "include",
    },
    6000000 // 1 minute timeout
  );
  dispatch({
    type: "reembed: request start",
    abortableFetch: af,
  });
  const res = await af.ready();

  if (res.ok && res.headers.get("Content-Type").includes("application/json")) {
    // #TOOD: TRIGGER CELL SUBSETTING AND AWAIT RESULTS!
    return res;
  }

  // else an error
  let msg = `Unexpected HTTP response ${res.status}, ${res.statusText}`;
  const body = await res.text();
  if (body && body.length > 0) {
    msg = `${msg} -- ${body}`;
  }
  throw new Error(msg);
}
/*
functions below are dispatch-able
*/
export function requestReembed(reembedParams,parentName,embName) {
  return async (dispatch, getState) => {
    try {
      await dispatch(subsetAction());
      const state = getState();
      const { controls, layoutChoice } = state;
      const { wsReembedding } = controls;

      let cells = state.annoMatrix.rowIndex.labels();
      cells = Array.isArray(cells) ? cells : Array.from(cells);

      wsReembedding.send(JSON.stringify({
        method: "umap",
        filter: { obs: { index: cells } },
        params: reembedParams,
        parentName: (parentName === "") ? layoutChoice.current : parentName,
        embName: embName,
      }))
      dispatch({
        type: "reembed: request start"
      });
    } catch (error) {
      dispatch({
        type: "reembed: request aborted",
      });
      if (error.name === "AbortError") {
        postAsyncFailureToast("Re-embedding calculation was aborted.");
      } else {
        postNetworkErrorToast(`Re-embedding: ${error.message}`);
      }
      console.log("Reembed exception:", error, error.name, error.message);
    }
  };
}


async function doPreprocessingFetch(dispatch, getState, reembedParams) {
  const state = getState();
  let cells = state.annoMatrix.rowIndex.labels();  
  cells = Array.isArray(cells) ? cells : Array.from(cells);
  const af = abortableFetch(
    `${API.prefix}${API.version}preprocess`,
    {
      method: "PUT",
      headers: new Headers({
        Accept: "application/octet-stream",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        params: reembedParams,
        filter: { obs: { index: cells } }
      }),
      credentials: "include",
    },
    6000000 // 1 minute timeout
  );
  dispatch({
    type: "preprocess: request start",
    abortableFetch: af,
  });
  const res = await af.ready();

  if (res.ok && res.headers.get("Content-Type").includes("application/json")) {
    // #TOOD: TRIGGER CELL SUBSETTING AND AWAIT RESULTS!
    return res;
  }

  // else an error
  let msg = `Unexpected HTTP response ${res.status}, ${res.statusText}`;
  const body = await res.text();
  if (body && body.length > 0) {
    msg = `${msg} -- ${body}`;
  }
  throw new Error(msg);
}
/*
functions below are dispatch-able
*/
export function requestPreprocessing(reembedParams) {
  return async (dispatch, getState) => {
    try {
      const {
        annoMatrix,
        controls
      } = getState();
      const { wsPreprocessing } = controls;
      let cells = annoMatrix.rowIndex.labels();  
      cells = Array.isArray(cells) ? cells : Array.from(cells);
      wsPreprocessing.send(JSON.stringify({
        params: reembedParams,
        filter: { obs: { index: cells } }
      }))
      dispatch({
        type: "preprocess: request start",
      });
    } catch (error) {
      dispatch({
        type: "preprocess: request aborted",
      });
      if (error.name === "AbortError") {
        postAsyncFailureToast("Preprocessing calculation was aborted.");
      } else {
        postNetworkErrorToast(`Preprocessing: ${error.message}`);
      }
      console.log("Preprocess exception:", error, error.name, error.message);
    }
  };
}
