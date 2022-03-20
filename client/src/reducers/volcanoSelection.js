const VolcanoSelection = (
  state = {
    tool: "lasso", // what selection tool mode (lasso, brush, ...)
    selection: { mode: "all" }, // current selection, which is tool specific
  },
  action
) => {
  switch (action.type) {
    case "set clip quantiles":
    case "subset to selection":
    case "reset subset":
    case "set layout choice": {
      return {
        ...state,
        selection: {
          mode: "all",
        },
      };
    }

    case "volcano brush end":
    case "volcano brush change": {
      const { brushCoords } = action;
      return {
        ...state,
        selection: {
          mode: "within-rect",
          brushCoords,
        },
      };
    }

    case "volcano lasso end": {
      const { polygon } = action;
      return {
        ...state,
        selection: {
          mode: "within-polygon",
          polygon,
        },
      };
    }

    case "volcano lasso cancel":
    case "volcano brush cancel":
    case "volcano lasso deselect":
    case "volcano brush deselect": {
      return {
        ...state,
        selection: {
          mode: "all",
        },
      };
    }

    default: {
      return state;
    }
  }
};

export default VolcanoSelection;
