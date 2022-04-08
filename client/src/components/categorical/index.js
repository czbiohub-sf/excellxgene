import React from "react";
import { AnchorButton, Tooltip, Position, NumericInput, Collapse, H4, H6, Dialog, Checkbox, InputGroup } from "@blueprintjs/core";
import { connect } from "react-redux";
import * as globals from "../../globals";
import Category from "./category";
import { AnnotationsHelpers, ControlsHelpers } from "../../util/stateManager";
import AnnoDialog from "../annoDialog";
import AnnoSelect from "./annoSelect";
import LabelInput from "../labelInput";
import { labelPrompt } from "./labelUtil";
import actions from "../../actions";
import {
  Dataframe,
} from "../../util/dataframe";

@connect((state) => ({
  annoMatrix: state.annoMatrix,
  writableCategoriesEnabled: state.config?.parameters?.annotations ?? false,
  schema: state.annoMatrix?.schema,
  ontology: state.ontology,
  userInfo: state.userInfo,
  resolution: state.Leiden.res,
  layoutChoice: state.layoutChoice,
  obsCrossfilter: state.obsCrossfilter,
  leidenController: state.leidenController,
  reembedController: state.reembedController,
  preprocessController: state.preprocessController,
  refresher: state.sankeySelection.refresher,
  numChecked: state.sankeySelection.numChecked,
  layoutChoice: state.layoutChoice,
  userLoggedIn: state.controls.userInfo ? true : false,
  outputController: state.outputController
}))
class Categories extends React.Component {
  constructor(props) {
    super(props);
    const { resolution } = props
    this.state = {
      createAnnoModeActive: false,
      newCategoryText: "",
      categoryToDuplicate: null,
      expandedCats: new Set(),
      value: resolution,
      deleteEnabled: false,
      fuseEnabled: false,
      leidenOpen: true,
      catsOpen: true,
      uploadMetadataOpen: false,
      fileName: "Choose file..."
    };
  }
  clamp = (num, min=Number.POSITIVE_INFINITY, max=Number.NEGATIVE_INFINITY) => {
    return Math.min(Math.max(num, min), max);
  }
  handleCreateUserAnno = (e) => {
    const { dispatch } = this.props;
    const { newCategoryText, categoryToDuplicate } = this.state;
    dispatch(
      actions.annotationCreateCategoryAction(
        newCategoryText,
        categoryToDuplicate
      )
    );
    this.setState({
      createAnnoModeActive: false,
      categoryToDuplicate: null,
      newCategoryText: "",
    });
    e.preventDefault();
  };

  componentDidUpdate(prevProps) {
    const { refresher, numChecked } = this.props;
    if (refresher !== prevProps.refresher) {
      this.setState({deleteEnabled: numChecked>0, fuseEnabled: numChecked>1})
    }
  }
  resetFileState = () => {
    this.setState({...this.state, 
      fileName: "Choose file...", 
      uploadMetadataOpen: false,
      newAnnos: null,
      clashingAnnos: null,
      annoArrays: null,
      selectedAnnos: null,
      newAnnoNames: null,
      annoDtypes: null
    })
  }
  handleFileUpload = () => {
      let { obsCrossfilter: crossfilter, annoMatrix, dispatch } = this.props;
      const { annoArrays, annoDtypes, newAnnoNames, newAnnos, clashingAnnos, selectedAnnos } = this.state;
      const colIdx = [];
      const arrays = [];
      const dtypes= [];
      newAnnos.forEach((item,ix)=>{
        if (selectedAnnos?.[item] ?? true){
          let name;
          if (clashingAnnos?.[item]){
            name = newAnnoNames[item];
          } else {
            name = item;
          }
          colIdx.push(name);
          arrays.push(annoArrays[ix]);
          dtypes.push(annoDtypes[ix])
        }
      });

      arrays.forEach((arr,ix)=>{
        if (dtypes[ix] === "cat"){
          const item = new Array(arr);
          const df = new Dataframe([item[0].length,1],item)
          const { categories: cat } = df.col(0).summarizeCategorical();
          if (!cat.includes(globals.unassignedCategoryLabel)) {
            cat.push(globals.unassignedCategoryLabel);
          }
          const ctor = item.constructor;
          const newSchema = {
            name: colIdx[ix],
            type: "categorical",
            categories: cat,
            writable: true,
          };       
          crossfilter = crossfilter.addObsColumn(
            newSchema,
            ctor,
            arr
          );  
          annoMatrix = crossfilter.annoMatrix;
        } else {
          const item = new Float32Array(arr);
          const ctor = item.constructor;
          const newSchema = {
            name: colIdx[ix],
            type: "float32",
            writable: true,
          };      
          crossfilter = crossfilter.addObsColumn(
            newSchema,
            ctor,
            item
          );  
          annoMatrix = crossfilter.annoMatrix;            
        } 
      });
      
    colIdx.forEach((item)=>{
      dispatch({
        type: "annotation: create category",
        data: item,
        categoryToDuplicate: null,
        annoMatrix,
        obsCrossfilter: crossfilter,
      });          
      dispatch({type: "track anno", anno: item})    

    })              
    this.resetFileState()
  }
  setupFileInput = () => {
    const context = this;
    const { schema } = this.props;

    function uploadDealcsv () {};
    uploadDealcsv.prototype.getCsv = function(e) {
      let input = document.getElementById('dealCsv');
      input.addEventListener('change', function() {
        if (this.files && this.files[0]) {

            var myFile = this.files[0];
            var reader = new FileReader();
            context.setState({...context.state,fileName: myFile.name})
            reader.addEventListener('load', function (e) {
                
                let csvdata = e.target.result; 
                parseCsv.getParsecsvdata(csvdata); // calling function for parse csv data 
            });
            
            reader.readAsBinaryString(myFile);
        }
      });
    }
    uploadDealcsv.prototype.getParsecsvdata = function(data) {
      let parsedata = [];

      let newLinebrk = data.split("\n");
      if (newLinebrk.at(-1)===""){
        newLinebrk = newLinebrk.slice(0,-1)
      }
      let numCols;
      for(let i = 0; i < newLinebrk.length; i++) {
        const x = newLinebrk[i].split("\t");
        if (numCols ?? false){
          if (x.length !== numCols || x.length === 1){
            context.resetFileState();
            throw new Error("TXT file improperly formatted");
          }
        }
        numCols = x.length;
        parsedata.push(x)
      }
      const colIdx = parsedata[0].slice(1);
      parsedata = parsedata.slice(1);
      const columns = [];
      const clashing = {};
      colIdx.forEach((item)=>{
        columns.push(new Map())
        if (schema.annotations.obsByName[item]) {
          clashing[item] = true;
        } else {
          clashing[item] = false;
        }
      })     
      const dtypes=[];
      parsedata.forEach((row,rowix)=>{
        row.slice(1).forEach((item,ix)=>{
          let dtype;
          if (!isNaN(item)){
            if (item.toString().indexOf('.') != -1){
              dtype="cont";
              columns[ix].set(row[0],parseFloat(item))
            } else {
              dtype="cat";
              columns[ix].set(row[0],parseInt(item))
            }
          } else {
            dtype="cat";
            columns[ix].set(row[0],item.toString())
          }
          if (rowix > 0){
            if (dtypes[ix] === "cont" && dtype !== "cont"){
              context.resetFileState();
              throw new Error("Each value in a continuous metadata column must be a float.");
            }
          } else {
            dtypes.push(dtype)
          }

        })
      })

      context.props.annoMatrix.fetch("obs", "name_0").then((nameDf)=>{
        const rowNames = nameDf.__columns[0];      
        const arrays = [];
        columns.forEach(()=>{
          arrays.push([])
        })
        rowNames.forEach((item) => {
          columns.forEach((map,ix)=>{
            if (dtypes[ix] === "cat"){
              arrays[ix].push(map.get(item) ?? "unassigned");
            } else {
              arrays[ix].push(map.get(item) ?? 0.0);
            }
          })
        })
        context.setState({...context.state, clashingAnnos: clashing, newAnnos: colIdx, annoArrays: arrays, annoDtypes: dtypes})        
      })
    }
    var parseCsv = new uploadDealcsv();
    parseCsv.getCsv();
  }
  handleEnableAnnoMode = () => {
    this.setState({ createAnnoModeActive: true });
  };
  handleLeidenClustering = () => {
    const { dispatch } = this.props
    dispatch(actions.requestLeiden())
  };
  handleDisableAnnoMode = () => {
    this.setState({
      createAnnoModeActive: false,
      categoryToDuplicate: null,
      newCategoryText: "",
    });
  };

  handleModalDuplicateCategorySelection = (d) => {
    this.setState({ categoryToDuplicate: d });
  };

  categoryNameError = (name) => {
    /*
    return false if this is a LEGAL/acceptable category name or NULL/empty string,
    or return an error type.
    */

    /* allow empty string */
    if (name === "") return false;

    /*
    test for uniqueness against *all* annotation names, not just the subset
    we render as categorical.
    */
    const { schema } = this.props;
    const allCategoryNames = schema.annotations.obs.columns.map((c) => c.name);
    /* check category name syntax */
    const error = AnnotationsHelpers.annotationNameIsErroneous(name);
    if (error) {
      return error;
    }

    /* disallow duplicates */
    if (allCategoryNames.indexOf(name) !== -1) {
      return "duplicate";
    }

    /* otherwise, no error */
    return false;
  };
  validateNewLabels = () => {
    const { newAnnoNames, newAnnos, clashingAnnos, selectedAnnos} = this.state;
    const { schema } = this.props;
    if (!newAnnos){
      return false;
    } else {
      const names = [];
      for (const name of newAnnos) {
        if (clashingAnnos?.[name] && (selectedAnnos?.[name] ?? true)) {
          if (!newAnnoNames?.[name]) {
            return false;
          } else if (newAnnoNames?.[name] === "") {
            return false;
          }
          names.push(newAnnoNames?.[name])
        } else {
          names.push(name)
        }
      }
      for (const item of schema.annotations.obs.columns) {
        names.push(item.name)
      }
      for (const name of newAnnos) {
        if (names.indexOf(newAnnoNames?.[name]) !== names.lastIndexOf(newAnnoNames?.[name]) && (selectedAnnos?.[name] ?? true)
            && (selectedAnnos?.[newAnnoNames?.[name]] ?? true)
          ) {
          return false;
        }
      }
    }
    return true;
  }
  handleChange = (name) => {
    this.setState({ newCategoryText: name });
  };

  handleSelect = (name) => {
    this.setState({ newCategoryText: name });
  };

  handleFuseLabels = () => {
    const { dispatch } = this.props
    dispatch(actions.requestFuseLabels())
  };  

  handleDeleteLabels = () => {
    const { dispatch } = this.props
    dispatch(actions.requestDeleteLabels())
  };  

  instruction = (name) => {
    return labelPrompt(
      this.categoryNameError(name),
      "New, unique category name",
      ":"
    );
  };

  onExpansionChange = (catName) => {
    const { expandedCats } = this.state;
    if (expandedCats.has(catName)) {
      const _expandedCats = new Set(expandedCats);
      _expandedCats.delete(catName);
      this.setState({ expandedCats: _expandedCats });
    } else {
      const _expandedCats = new Set(expandedCats);
      _expandedCats.add(catName);
      this.setState({ expandedCats: _expandedCats });
    }
  };
  handleSaveMetadata = () => {
    const { dispatch } = this.props;
    dispatch(actions.downloadMetadata())
  }  

  render() {
    const {
      createAnnoModeActive,
      categoryToDuplicate,
      newCategoryText,
      expandedCats,
      value,
      deleteEnabled,
      fuseEnabled,
      leidenOpen,
      catsOpen,
      uploadMetadataOpen,
      fileName,
      clashingAnnos,
      newAnnos,
      selectedAnnos,
      newAnnoNames,
      annoDtypes
    } = this.state;
    const {
      schema,
      ontology,
      userInfo,
      leidenController,
      reembedController,
      preprocessController,
      dispatch,
      layoutChoice,
      userLoggedIn,
      leftSidebarWidth,
      outputController
    } = this.props;
    const ontologyEnabled = ontology?.enabled ?? false;
    const loading = !!leidenController?.pendingFetch;// || !!reembedController?.pendingFetch || !!preprocessController?.pendingFetch;
    const saveLoading = !!outputController?.pendingFetch;
    /* all names, sorted in display order.  Will be rendered in this order */
    const allCategoryNames = ControlsHelpers.selectableCategoryNames(
      schema
    ).sort();
    const disableLoad = !this.validateNewLabels();
    return (
        <div
          style={{
            padding: globals.leftSidebarSectionPadding,
          }}
        >
          <AnnoDialog
            isActive={createAnnoModeActive}
            title="Create new category"
            instruction={this.instruction(newCategoryText)}
            cancelTooltipContent="Close this dialog without creating a category."
            primaryButtonText="Create new category"
            primaryButtonProps={{ "data-testid": "submit-category" }}
            text={newCategoryText}
            validationError={this.categoryNameError(newCategoryText)}
            handleSubmit={this.handleCreateUserAnno}
            handleCancel={this.handleDisableAnnoMode}
            annoInput={
              <LabelInput
                labelSuggestions={ontologyEnabled ? ontology.terms : null}
                onChange={this.handleChange}
                onSelect={this.handleSelect}
                inputProps={{
                  "data-testid": "new-category-name",
                  leftIcon: "tag",
                  intent: "none",
                  autoFocus: true,
                }}
                newLabelMessage="New category"
              />
            }
            annoSelect={
              <AnnoSelect
                handleModalDuplicateCategorySelection={
                  this.handleModalDuplicateCategorySelection
                }
                categoryToDuplicate={categoryToDuplicate}
                allCategoryNames={allCategoryNames}
              />
            }
          />
          
          {userLoggedIn && (
            <div style={{display: "flex", flexDirection: "column"}}>
              <div style={{
                paddingBottom: "10px",
                columnGap: "5px",
                display: "flex"
              }}>
                <Tooltip
                content="Save selected metadata categories to a tab-delimited .txt file."
                position="bottom"
                hoverOpenDelay={globals.tooltipHoverOpenDelay}
              >                                              
                <AnchorButton
                    type="button"
                    loading={saveLoading}
                    icon="floppy-disk"
                    onClick={() => {
                      this.handleSaveMetadata()
                    }}
                  /> 
                </Tooltip> 
                <Tooltip
                content="Upload metadata from a `.txt`, tab-delimited file."
                position="bottom"
                hoverOpenDelay={globals.tooltipHoverOpenDelay}
              >                                              
                <AnchorButton
                    type="button"
                    icon="upload"
                    disabled={!userLoggedIn}
                    onClick={() => {
                      this.setState({...this.state,uploadMetadataOpen: true})
                    }}
                  /> 
                </Tooltip>                 
                  <Dialog
                    title="Upload metadata file (tab-delimited .txt)"
                    isOpen={uploadMetadataOpen}
                    onOpened={()=>this.setupFileInput()}
                    onClose={()=>{
                      this.resetFileState();
                      }
                    }
                  >
                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      paddingLeft: "10px",
                      paddingTop: "10px",
                      width: "90%",
                      margin: "0 auto"
                    }}>
                      <label className="bp3-file-input">
                        <input type="file" id="dealCsv"/>
                        <span className="bp3-file-upload-input">{fileName}</span>
                      </label>           

                      <div style={{display: "flex", flexDirection: "column"}}>
                      {newAnnos ? 
                        <div style={{paddingBottom: "10px"}}><hr/>
                        <b>Select which annotations to load...</b></div> : null}  
                      {annoDtypes?.includes("cat") ? <H6>Categorical</H6> : null}
                      {newAnnos?.map((name,ix)=>{
                        if (annoDtypes[ix] !== "cat") return null;
                        return (
                          <div key={`${name}-anno-div`} style={{display: "flex", flexDirection: "row", justifyContent: "space-between", width: "60%"}}>
                          <Checkbox key={`${name}-new-anno`} checked={selectedAnnos?.[name] ?? true} label={name}
                            style={{margin: "auto 0", paddingRight: "10px"}}
                            onChange={() => {
                                const sannos = selectedAnnos ?? {};
                                const {[name]: _, ...sannosExc } = sannos;
                                this.setState({...this.state,selectedAnnos: {[name]: !(sannos?.[name] ?? true), ...sannosExc}})
                              }
                            } 
                          />    
                          {clashingAnnos?.[name] ? <InputGroup
                            key={`${name}-input-cat`}
                            id={`${name}-input-anno`}
                            placeholder="Enter a unique name..."
                            onChange={(e)=>{
                              const nan = newAnnoNames ?? {};
                              const {[name]: _, ...nanExc } = nan;   
                              this.setState({...this.state,newAnnoNames: {[name]: e.target.value, ...nanExc}})
                            }}
                            value={newAnnoNames?.[name] ?? ""}
                          /> : null}      
                          </div>                                          
                        );
                      }) ?? null}
                      {annoDtypes?.includes("cont") ? <H6>Continuous</H6> : null}
                      {newAnnos?.map((name,ix)=>{
                        if (annoDtypes[ix] !== "cont") return null;
                        return (
                          <div key={`${name}-anno-div`} style={{display: "flex", flexDirection: "row", justifyContent: "space-between", width: "60%"}}>
                          <Checkbox key={`${name}-new-anno`} checked={selectedAnnos?.[name] ?? true} label={name}
                            style={{margin: "auto 0", paddingRight: "10px"}}
                            onChange={() => {
                                const sannos = selectedAnnos ?? {};
                                const {[name]: _, ...sannosExc } = sannos;
                                this.setState({...this.state,selectedAnnos: {[name]: !(sannos?.[name] ?? true), ...sannosExc}})
                              }
                            } 
                          />    
                          {clashingAnnos?.[name] ? <InputGroup
                            key={`${name}-input-cat`}
                            id={`${name}-input-anno`}
                            placeholder="Enter a unique name..."
                            onChange={(e)=>{
                              const nan = newAnnoNames ?? {};
                              const {[name]: _, ...nanExc } = nan;   
                              this.setState({...this.state,newAnnoNames: {[name]: e.target.value, ...nanExc}})
                            }}
                            value={newAnnoNames?.[name] ?? ""}
                          /> : null}      
                          </div>                                          
                        );
                      }) ?? null}                      
                      <br/>
                      {newAnnos ? <AnchorButton
                        intent={!disableLoad ? "primary" : "danger"}
                        disabled={disableLoad}
                        onClick={this.handleFileUpload}
                      >
                        {disableLoad ? "Label name collision": "Load"}
                      </AnchorButton> : null}
                      </div>
                    </div>                                
                  </Dialog> 
                </div>    

              {userLoggedIn && <div  style={{
                display: 'inline-flex',
                justifyContent: 'space-between',
                margin: '0 0',
                marginBottom: 10,
                columnGap: "5px"
              }}>               
                <Tooltip
                  content={
                    userInfo.is_authenticated
                      ? "Create a new category"
                      : "You must be logged in to create new categorical fields"
                  }
                  position={Position.RIGHT}
                  boundary="viewport"
                  hoverOpenDelay={globals.tooltipHoverOpenDelay}
                  modifiers={{
                    preventOverflow: { enabled: false },
                    hide: { enabled: false },
                  }}
                >
                  <AnchorButton
                    type="button"
                    data-testid="open-annotation-dialog"
                    onClick={this.handleEnableAnnoMode}
                    intent="primary"
                    disabled={!userInfo.is_authenticated || !userLoggedIn}
                  >
                    Create new <strong>category</strong>
                  </AnchorButton>
                </Tooltip>
                  <AnchorButton
                    style={{"height":"20px"}}
                    type="button"
                    data-testid="leiden-cluster"
                    onClick={this.handleLeidenClustering}
                    intent="primary"
                    disabled={loading || !userLoggedIn}
                  >
                    <strong>Leiden</strong> cluster
                  </AnchorButton>     
                  <Tooltip
                      content="Leiden clustering resolution parameter"
                      position={Position.BOTTOM}
                      boundary="viewport"
                      hoverOpenDelay={globals.tooltipHoverOpenDelay}
                      modifiers={{
                        preventOverflow: { enabled: false },
                        hide: { enabled: false },
                      }}
                    >                       
                      <NumericInput
                        style={{"width":"40px"}}
                        placeholder={value}
                        value={value}
                        onValueChange={
                          (_valueAsNumber, valueAsString) => {
                            let val = valueAsString;
                            dispatch({
                              type: "leiden: set resolution",
                              res: parseFloat(val)
                            })
                            this.setState({value: val})
                          }
                        }
                      />
                  </Tooltip>
                </div> }
                {userLoggedIn && <div  style={{
                  display: 'inline-flex',
                  justifyContent: 'space-between',
                  margin: '0 0',
                  marginBottom: 10,
                  columnGap: "5px"
                }}>
                  <AnchorButton
                    style={{"height":"20px", marginBottom: 10, width: "50%", margin: '0 0',}}
                    type="button"
                    data-testid="fuse-labels"
                    onClick={this.handleFuseLabels}
                    intent="primary"
                    disabled={!fuseEnabled || !userLoggedIn}
                  >
                    <strong>Fuse</strong> labels
                  </AnchorButton>   
                  <AnchorButton
                    style={{"height":"20px", marginBottom: 10, width: "50%", margin: '0 0',}}
                    type="button"
                    data-testid="delete-labels"
                    onClick={this.handleDeleteLabels}
                    intent="primary"
                    disabled={!deleteEnabled || layoutChoice.sankey || !userLoggedIn}
                  >
                    <strong>Delete</strong> labels
                  </AnchorButton>                     
                </div>}
              </div>            
        )}

        {/* READ ONLY CATEGORICAL FIELDS */}
        {/* this is duplicative but flat, could be abstracted */}
        <AnchorButton
              onClick={() => {
                this.setState({ 
                  leidenOpen: !leidenOpen
                });
              }}
              text={<span><H4>Leiden clustering</H4></span>}
              fill
              minimal
              rightIcon={leidenOpen ? "chevron-down" : "chevron-right"} small
        />               
        <Collapse isOpen={leidenOpen}>
          {allCategoryNames.map((catName) =>
            schema.annotations.obsByName[catName].writable && catName.startsWith('leiden_v') ? (
              <Category
                key={catName}
                metadataField={catName}
                onExpansionChange={this.onExpansionChange}
                isExpanded={expandedCats.has(catName)}
                createAnnoModeActive={createAnnoModeActive}
                leftSidebarWidth={leftSidebarWidth}
              />
            ) : null
          )}
        </Collapse>        
        {/*{allCategoryNames.map((catName) =>
          !schema.annotations.obsByName[catName].writable &&
          (schema.annotations.obsByName[catName].categories?.length > 1 ||
            !schema.annotations.obsByName[catName].categories) && !catName.startsWith('leiden_v') ? (
            <Category
              key={catName}
              metadataField={catName}
              onExpansionChange={this.onExpansionChange}
              isExpanded={expandedCats.has(catName)}
              createAnnoModeActive={createAnnoModeActive}
            />
          ) : null
        )}*/}
        <hr/>
        <AnchorButton
              onClick={() => {
                this.setState({ 
                  catsOpen: !catsOpen
                });
              }}
              text={<span><H4>Categorical</H4></span>}
              fill
              minimal
              rightIcon={catsOpen ? "chevron-down" : "chevron-right"} small
        />          
        {/* WRITEABLE FIELDS */}
        <Collapse isOpen={catsOpen}>
        {allCategoryNames.map((catName) =>
          schema.annotations.obsByName[catName].writable && !catName.startsWith('leiden_v') ? (
            <Category
              key={catName}
              metadataField={catName}
              onExpansionChange={this.onExpansionChange}
              isExpanded={expandedCats.has(catName)}
              createAnnoModeActive={createAnnoModeActive}
              leftSidebarWidth={leftSidebarWidth}
            />
          ) : null
        )}</Collapse>       
      </div>
    );
  }
}

export default Categories;
