import uniq from "lodash.uniq";
import filter from "lodash.filter";

const Controls = (
  state = {
    // data loading flag
    loading: true,
    error: null,
    // all of the data + selection state
    userDefinedGenes: [],
    userDefinedGenesLoading: false,
    isSubsetted: false,
    resettingInterface: false,
    graphInteractionMode: "select",
    opacityForDeselectedCells: 0.2,
    scatterplotXXaccessor: null, // just easier to read
    scatterplotYYaccessor: null,
    graphRenderCounter: 0 /* integer as <Component key={graphRenderCounter} - a change in key forces a remount */,
    allGenes: null,
    datasetDrawer: false,
    userInfo: null,
    hostedMode: false,
    modifyingLayouts: false,
    screenCap: false,
    annoTracker: [],
    setTracker: [],
    varMetadata: "",
    varRefresher: false,
    currentSelectionDEG: null,
    scatterplotXXisObs: false,
    scatterplotYYisObs: false,
    undoed: false,
    volcanoAccessor: null,
    pointScaler: 1.0,
    chromeKeyContinuous: "Spectral",
    chromeKeyCategorical: "Rainbow",
    cxgMode: "OBS",
    jointEmbeddingFlag: true,
    jointMode: false,
    multiGeneSelect: false,
    lastClickedGene: null,
    lastClickedGeneset: null,
    currentlyDragged: null,
    justCreatedGeneset: false,
    snapT: 1.5
  },
  action
) => {
  /*
  For now, log anything looking like an error to the console.
  */
  if (action.error || /error/i.test(action.type)) {
    console.error(action?.error ?? "Error.");
  }
  switch (action.type) {
    case "initial data load start": {
      return { ...state, loading: true, isSubsetted: false, };
    }
    case "initial data load complete": {
      /* now fully loaded */
      const defaultValue = (state?.allGenes ?? null);
      return {
        ...state,
        loading: false,
        error: null,
        resettingInterface: false,
        isSubsetted: false,
        allGenes: action.allGenes ?? defaultValue
      };
    }
    case "set multiple gene select on": {
      return {
        ...state,
        multiGeneSelect: true
      }
    }
    case "set multiple gene select off": {
      return {
        ...state,
        multiGeneSelect: false
      }
    }    
    case "last clicked gene": {
      return {
        ...state,
        lastClickedGene: action.gene
      }
    }
    case "init: set up websockets": {
      return {
        ...state,
        [action.name]: action.ws
      };
    }   
    case "set point scaler": {
      return {
        ...state,
        pointScaler: action.scaler
      };
    }     
    case "set chrome key categorical": {
      return {
        ...state,
        chromeKeyCategorical: action.key
      };
    } 
    case "set chrome key continuous": {
      return {
        ...state,
        chromeKeyContinuous: action.key
      };
    }             
    case "set current selection DEG": {
      return {
        ...state,
        currentSelectionDEG: action.name
      };
    }       
    case "set snapT": {
      return {
        ...state,
        snapT: action.value
      }
    }
    case "track anno": {
      const { annoTracker } = state;
      annoTracker.push(action.anno);
      return {
        ...state,
        annoTracker
      };
    } 
    case "geneset just created": {
      return {
        ...state,
        justCreatedGeneset: action.bool
      }
    }    
    case "track set": {
      const { setTracker } = state;
      setTracker.push([action.group,action.set]);
      return {
        ...state,
        setTracker
      };
    }
    case "currently dragging": {
      return {
        ...state,
        currentlyDragged: action.dragged
      }
    }
    case "autosave: genesets complete": {
      let setTracker = state.setTracker;
      action.sets.forEach((item)=>{
        setTracker = setTracker.filter((a)=>a!==item);
      })
      return {
        ...state,
        setTracker: setTracker
      }
    }          
    case "set var key": {
      return {
        ...state,
        varMetadata: action.key
      }
    }
    case "writable obs annotations - save complete": {
      let annoTracker = state.annoTracker;
      action.annos.forEach((item)=>{
        annoTracker = annoTracker.filter((a)=>a!==item);
      })
      return {
        ...state,
        annoTracker: annoTracker
      }
    }
    case "graph: screencap start": {
      return {
        ...state,
        screenCap: true
      }
    }
    case "graph: screencap end": {
      return {
        ...state,
        screenCap: false
      }
    } 
    case "set undo flag": {
      return {
        ...state,
        undoed: true
      }
    } 
    case "reset undo flag": {
      return {
        ...state,
        undoed: false
      }
    }         
    case "set display joint embedding flag": {
      return {
        ...state,
        jointEmbeddingFlag: action.value
      }
    }
    case "modifying layouts": {
      return {
        ...state,
        modifyingLayouts: action.modifyingLayouts
      }
    } 
    case "reset subset": {
      return {
        ...state,
        resettingInterface: false,
        isSubsetted: false,
      };
    }
    case "subset to selection": {
      return {
        ...state,
        loading: false,
        error: null,
        isSubsetted: true,
      };
    }
    case "set user info": {
      return {
        ...state,
        userInfo: action.userInfo
      }
    }
    case "set hosted mode": {
      return {
        ...state,
        hostedMode: action.hostedMode
      }
    }  
    case "set joint mode": {
      return {
        ...state,
        jointMode: action.jointMode
      }
    }      
    case "set cxg mode": {
      return {
        ...state,
        cxgMode: action.cxgMode
      }
    }        
    case "request user defined gene started": {
      return {
        ...state,
        userDefinedGenesLoading: true,
      };
    }
    case "request user defined gene error": {
      return {
        ...state,
        userDefinedGenesLoading: false,
      };
    }
    case "request user defined gene success": {
      const { userDefinedGenes } = state;
      const _userDefinedGenes = uniq(
        userDefinedGenes.concat(action.data.genes)
      );
      return {
        ...state,
        userDefinedGenes: _userDefinedGenes,
        userDefinedGenesLoading: false,
      };
    }
    case "refresh var metadata": {
      return {
        ...state,
        varRefresher: !state.varRefresher
      }
    }        
    case "clear user defined gene": {
      const { userDefinedGenes } = state;
      const newUserDefinedGenes = filter(
        userDefinedGenes,
        (d) => d !== action.data
      );
      return {
        ...state,
        userDefinedGenes: newUserDefinedGenes,
      };
    }
    case "initial data load error": {
      return {
        ...state,
        loading: false,
        error: action.error,
      };
    }
    /*******************************
             User Events
     *******************************/
    case "change graph interaction mode":
      return {
        ...state,
        graphInteractionMode: action.data,
      };
    case "change opacity deselected cells in 2d graph background":
      return {
        ...state,
        opacityForDeselectedCells: action.data,
      };
    case "increment graph render counter": {
      const c = state.graphRenderCounter + 1;
      return {
        ...state,
        graphRenderCounter: c,
      };
    }

    /*******************************
              Scatterplot
    *******************************/
    case "set scatterplot x":
      return {
        ...state,
        scatterplotXXaccessor: action.data,
        scatterplotXXisObs: action?.isObs ?? false
      };
    case "set scatterplot y":
      return {
        ...state,
        scatterplotYYaccessor: action.data,
        scatterplotYYisObs: action?.isObs ?? false
      };
    case "clear scatterplot":
      return {
        ...state,
        scatterplotXXaccessor: null,
        scatterplotYYaccessor: null,
        scatterplotYYisObs: false,
        scatterplotYYisObs: false
      };
    /*******************************
              Volcano plot
    *******************************/
    case "set volcano accessor":
      return {
        ...state,
        volcanoAccessor: action.data,
      };
    case "clear volcano plot":
      return {
        ...state,
        volcanoAccessor: null,
      };
    /**************************
          Dataset Drawer
     **************************/
    case "toggle dataset drawer":
      return { ...state, datasetDrawer: !state.datasetDrawer };

    default:
      return state;
  }
};

export default Controls;
