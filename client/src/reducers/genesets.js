import _ from "lodash";

/**
 * Gene set state. Geneset UI state is in a different reducer.
 *
 * geneset reducer state is a Map object, where:
 *  key: the geneset name, a string.
 *  val: the geneset defined as an object ("geneset object")
 *
 * A geneset object is:
 * {
 *    genesetName: <string>  # same as the map key
 *    genesetDescription: <string>
 *    genes: Map<<string>, {
 *      geneSymbol: <string>,  # same as the map key
 *      geneDescription: <string>
 *    }>
 * }
 *
 * Geneset and genes Map order is significant, and will be preserved across
 * CRUD operations on either.
 *
 * This reducer does light error checking, but not as much as the backend
 * routes. Do not rely on it to enforce geneset integrity - eg, no duplicate
 * genes in a geneset.
 */
const GeneSets = (
  state = {
    initialized: false,
    lastTid: undefined,
    genesets: {},
    diffExpListsLists: [],
    diffExpListsNames: [],
    selectedGenesLasso: []
  },
  action
) => {
  switch (action.type) {
    /**
     * Initial, load-time bootstrap.
     * {
     *    type: "geneset: initial load"
     *    data: JSON response
     * }
     */
    case "geneset: initial load": {
      const { data } = action;

      const { tid: lastTid, genesets } = data;
      return {
        ...state,
        initialized: true,
        lastTid,
        genesets,
      };
    }

    /**
     * Creates a new & empty geneset with the given name and description.
     * {
     *    type: "geneset: create",
     *    genesetName: string, // gene set name
     *    genesetDescription: string, // geneset description
     * }
     *
     */
    case "geneset: create": {
      const { genesetName, genesetDescription } = action;
      if (
        typeof genesetName !== "string" ||
        !genesetName ||
        genesetDescription === undefined
      )
        throw new Error("geneset: create -- name or description unspecified.");

      const genesets = {...state.genesets};
      const gs = genesets?.[genesetDescription] ?? {};
      const symbols = gs?.[genesetName] ?? [];
      
      genesets[genesetDescription] = gs;
      genesets[genesetDescription][genesetName] = symbols;

      return {
        ...state,
        genesets,
      };
    }

    /**
     * Deletes the named geneset, if it exists. Throws if it does not.
     * {
     *    type: "geneset: delete",
     *    genesetName: string
     * }
     */
    case "geneset: delete": {
      const { genesetDescription, genesetName } = action;
      if (!(genesetDescription in state.genesets))
        throw new Error("geneset: delete -- geneset group does not exist.");
      if (!(genesetName in state.genesets[genesetDescription]))
        throw new Error("geneset: delete -- geneset name does not exist.");

      const genesets = {...state.genesets}; // clone
      const gs = genesets[genesetDescription];
      const {[genesetName]: _, ...gsNew} = gs;
      genesets[genesetDescription] = gsNew;
      return {
        ...state,
        genesets,
      };
    }
    case "geneset: group delete": {
      const { genesetDescription } = action;
      const {[genesetDescription]: _, ...genesetsNew} = state.genesets;
      return {
        ...state,
        genesets: genesetsNew
      };
    }    

    case "geneset: update": {
      const { genesetDescription, genesetName, update } = action;

      
      if (!(genesetDescription in state.genesets))
        throw new Error("geneset: update -- geneset group does not exist.");

      if (genesetName) {
        if (!(genesetName in state.genesets[genesetDescription]))
          throw new Error("geneset: update -- geneset name does not exist.");

        /* now that we've confirmed the gene set exists, check for duplicates */
        const descriptionIsDuplicate = update.genesetDescription in state.genesets;
        let genesetNameIsDuplicate;
        if (descriptionIsDuplicate){
          genesetNameIsDuplicate = update.genesetName in state.genesets[update.genesetDescription];
        } else {
          genesetNameIsDuplicate = false;
        }

        if (genesetNameIsDuplicate && descriptionIsDuplicate)
          throw new Error(
            "geneset: update -- update specified existing name and description."
          );
        
        
        const newGenesets = {};
        const genesets = state.genesets;
        
        for (const key in genesets) {
          if (key === genesetDescription) {
            if (!(genesetDescription in newGenesets)){
              newGenesets[genesetDescription] = {};          
            }
            if (!(update.genesetDescription in newGenesets)){
              newGenesets[update.genesetDescription] = {};
            }
          } else {
            if (!(key in newGenesets)){
              newGenesets[key] = {};
            }
          }
          
          
          for (const key2 in genesets[key]) {
            if (key === genesetDescription && key2 === genesetName) {
              const x =  key.includes('//;;//') ? '//;;//' : '';
              newGenesets[`${update.genesetDescription}${x}`][`${update.genesetName}`] = genesets[key][key2]
            } else {
              newGenesets[key][`${key2}`] = genesets[key][key2]
            }
          }
          if (Object.keys(newGenesets[key]).length === 0) {
            delete newGenesets[key];
          }
        }
        return {
          ...state,
          genesets: newGenesets,
        };          
      } else {
        const newGenesets = {};
        const genesets = state.genesets;
        
        for (const key in genesets) {
          if (key === genesetDescription) {
            newGenesets[update.genesetDescription] = {...genesets[key]};
          } else {
            newGenesets[key] = {...genesets[key]}
          }         
        }
        return {
          ...state,
          genesets: newGenesets,
        }; 
      }        
    }

    /**
     * Adds genes to the geneset.  They are appended to the END of the geneset, in the
     * order provided. Duplicates or genes already in the geneset, will be ignored.
     * {
     *    type: "geneset: add genes"
     *    genesetName: <string>, // gene set name
     *    genes: Array<{
     *      geneSymbol: <string>,
     *      geneDescription: <string>
     *    }>
     * }
     *
     * Example:
     *   dispatch({
     *     type: "add genes",
     *     genesetName: "foo",
     *     genes: [ { geneSymbol: "FOXP", geneDescription: "test" }]
     *   });
     */
    case "geneset: add genes": {
      const { genesetDescription, genesetName, genes } = action;
      if (!(genesetDescription in state.genesets))
        throw new Error("geneset: add genes -- geneset group does not exist.");
      if (!(genesetName in state.genesets[genesetDescription]))
        throw new Error("geneset: add genes -- geneset name does not exist.");        

      // add
      const union = [...new Set([...state.genesets[genesetDescription][genesetName],...genes])];

      const genesets = {...state.genesets};
      const gs = {...genesets[genesetDescription]}
      gs[genesetName] = union;
      genesets[genesetDescription] = gs;
      return {
        ...state,
        genesets,
      };
    }

    /**
     * Delete genes from the named geneset. Will throw if the genesetName does
     * not exist.  Will ignore geneSymbols that do not exist.
     * {
     *    type: "geneset: delete genes",
     *    genesetName: <string>, // the geneset from which to delete genes
     *    geneSymbols: [<string>, ...], // the gene symbols to delete.
     * }
     *
     * Example:
     *  dispatch({
     *    type: "geneset: delete genes",
     *    genesetName: "a geneset name",
     *    geneSymbols: ["F5"]
     *  })
     */
    case "geneset: delete genes": {
      const { genesetDescription, genesetName, geneSymbols } = action;
      if (!(genesetDescription in state.genesets))
        throw new Error("geneset: delete genes -- geneset group does not exist.");
      if (!(genesetName in state.genesets[genesetDescription]))
        throw new Error("geneset: delete genes -- geneset name does not exist.");        

      const genesets = {...state.genesets};
      const gs = {...state.genesets[genesetDescription]}
      let genes = gs[genesetName].slice();
      for (const geneSymbol of geneSymbols) {
        genes = genes.filter(item => item !== geneSymbol)
      }
      gs[genesetName] = genes;
      genesets[genesetDescription] = gs;
      return {
        ...state,
        genesets,
      };
    } case "set other mode selection": {
      return {
        ...state,
        selectedGenesLasso: action.selected
      }
    }
    /**
     * Used by autosave to update the server synchronization TID
     */
    case "geneset: set tid": {
      const { tid } = action;
      if (!Number.isInteger(tid) || tid < 0)
        throw new Error("TID must be a positive integer number");
      if (state.lastTid !== undefined && tid < state.lastTid)
        throw new Error("TID may not be decremented.");
      return {
        ...state,
        lastTid: tid,
      };
    }
    case "request differential expression all success": {
      const { dataList, nameList, dateString, grouping } = action;
      const genesets = {...state.genesets};
      genesets[`${grouping} (${dateString})//;;//`] = {};

      for (const [i, data] of dataList.entries()) {
        const name = nameList[i];

        const polarity = `${name}`;
        const genes = data['positive'].map((diffExpGene) =>
            diffExpGene[0])
        genesets[`${grouping} (${dateString})//;;//`][`${polarity}`] = genes;

      }
      return {
        ...state,
        genesets,
        diffExpListsLists: [],
        diffExpListsNames: []
      };
    }
    case "request differential expression push list": {
      const { diffExpListsLists, diffExpListsNames } = state;
      diffExpListsLists.push(action.data)
      diffExpListsNames.push(action.name)
      return {
        ...state,
        diffExpListsLists,
        diffExpListsNames
      }
    }
    case "request differential expression success": {
      const { data, dateString } = action;

      const genesetNames = {
        positive: `Pop1 high`,
        negative: `Pop2 high`,
      };
      
      const genesets = {...state.genesets};
      genesets[`${dateString}//;;//`] = {};

      for (const polarity of Object.keys(genesetNames)) {
        const num = polarity === 'positive' ? "1" : "2";
        const genes = data[polarity].map((diffExpGene) =>
            diffExpGene[0])
        genesets[`${dateString}//;;//`][`${genesetNames[polarity]}`] = genes;
      }
      return {
        ...state,
        genesets,
        diffExpListsLists: [],
        diffExpListsNames: []
      };
    }

    default:
      return state;
  }
};

export default GeneSets;
