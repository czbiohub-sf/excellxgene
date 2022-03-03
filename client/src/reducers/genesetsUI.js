/*
Reducers for geneset UI-state.
*/
const GeneSetsUI = (
  state = {
    createGenesetModeActive: false,
    isEditingGenesetGroup: false,
    isEditingGenesetName: false,
    isAddingGenesToGeneset: false,
    isAddingGenesToGenesetGroup: false,
  },
  action
) => {
  switch (action.type) {
    /**
     * Activate interface for adding a new geneset
     * No params, if the action is fired we flip
     * a boolean here.
     */
    case "geneset: activate add new geneset mode": {
      return {
        ...state,
        createGenesetModeActive: true,
      };
    }
    /**
     * Disable interface for adding a new geneset
     * No params, if the action is fired we flip
     * a boolean here.
     */
    case "geneset: disable create geneset mode": {
      return {
        ...state,
        createGenesetModeActive: false,
      };
    }
    /**
     * Activate the interface for adding new genes to a geneset
     * isAddingGenesToGeneset {
     *  geneset: string, name of geneset
     * },
     */
    case "geneset: activate add new genes mode": {
      return {
        ...state,
        isAddingGenesToGenesetGroup: action.group,
        isAddingGenesToGeneset: action.geneset,
      };
    }
    /**
     * Disable the interface for adding new genes to a geneset
     * No params, if the action is fired we flip
     * a boolean here.
     */
    case "geneset: disable add new genes mode": {
      return {
        ...state,
        isAddingGenesToGenesetGroup: false,
        isAddingGenesToGeneset: false,
      };
    }
    /**
     * Activate the interface for renaming a geneset
     * isEditingGenesetName: {
     *   type: "geneset: activate rename geneset mode",
     *   data: geneset, // a string, name of geneset
     * }
     */
    case "geneset: activate rename geneset mode": {
      return {
        ...state,
        isEditingGenesetGroup: action.group,
        isEditingGenesetName: action.name,
      };
    }
    /**
     * Disable the interface for renaming a geneset
     * No params, if the action is fired we flip
     * a boolean here.
     */
    case "geneset: disable rename geneset mode": {
      return {
        ...state,
        isEditingGenesetGroup: false,
        isEditingGenesetName: false,
      };
    }

    default:
      return state;
  }
};

export default GeneSetsUI;
