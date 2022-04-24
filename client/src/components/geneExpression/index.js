import React from "react";
import { connect } from "react-redux";
import { Button, Icon, Collapse, H4, AnchorButton, Tooltip, Position, MenuItem, Dialog } from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";
import { AnnoMatrixObsCrossfilter } from "../../annoMatrix";
import { IconNames } from "@blueprintjs/icons";
import ParameterInput from "../menubar/parameterinput";
import GeneSet from "./geneSet";
import { GenesetHotkeys } from "../hotkeys";
import actions from "../../actions";
import Truncate from "../util/truncate"
import CreateGenesetDialogue from "./menus/createGenesetDialogue";
import * as globals from "../../globals";
import AnnoDialog from "../annoDialog";
import LabelInput from "../labelInput";

@connect((state) => {
  let var_keys = state.annoMatrix?.schema?.annotations?.varByName ?? {};
  var_keys = Object.keys(var_keys);
  const vk = [];
  var_keys.forEach((item)=>{
    if (item !== "name_0"){
      vk.push(item.split(';;').at(0))
    }   
  })  
  return {
    var_keys: [... new Set(vk)],
    allGenes: state.controls.allGenes.__columns[0],
    colorAccessor: state.colors.colorAccessor,
    genesets: state.genesets.genesets,
    annoMatrix: state.annoMatrix,
    reembedParams: state.reembedParameters,
    userLoggedIn: state.controls.userInfo ? true : false,
    outputController: state.outputController,
    cxgMode: state.controls.cxgMode
  };
})
class GeneExpression extends React.Component {
  constructor(props){
    super(props);
    this.state={
      geneSetsExpanded: true,
      isEditingSetName: false,
      newNameText: "",
      nameBeingEdited: "",
      varMetadata: "",
      fileName: "Choose file...",
      fileName2: "Choose file...",
      uploadMetadataOpen: false,
      uploadMetadataOpen2: false
    };
  }

  handleChangeOrSelect = (name) => {
    const { nameBeingEdited } = this.state;
    const suffix = nameBeingEdited.includes('//;;//') ? '//;;//' : ''
    this.setState({
      newNameText: `${name}${suffix}`,
    });
  };

  activateEditNameMode = (e, name) => {
    this.setState({
      newNameText: name,
      isEditingSetName: true,
      nameBeingEdited: name,
    })
    e.preventDefault();
  };
  disableEditNameMode = () => {
    this.setState({
      newNameText: "",
      isEditingSetName: false,
      nameBeingEdited: ""
    })
  };
  handleEditName = (e) => {
    const { dispatch } = this.props;
    const { newNameText, nameBeingEdited } = this.state

    const oldName = nameBeingEdited;
    const newName = newNameText;

    if (oldName !== newName) {
      dispatch({type: "geneset: update",genesetDescription: oldName, update: {genesetDescription: newName}})
    }
    dispatch(actions.requestDiffRename(oldName.split('//;;//').at(0),newName.split('//;;//').at(0)))    
    dispatch(actions.requestSetRename(oldName,newName)) 
    dispatch({type: "track set", group: newName, set: null})   
    this.disableEditNameMode()
  }
  setupFileInput = () => {
    const context = this;
    const { dispatch } = this.props;

    function uploadDealcsv () {};
    uploadDealcsv.prototype.getCsv = function(e) {
      let input = document.getElementById('dealCsv2');
      input.addEventListener('change', function() {
        if (this.files && this.files[0]) {

            var myFile = this.files[0];
            var reader = new FileReader();
            context.setState({...context.state,fileName: myFile.name})
            reader.addEventListener('load', function (e) {
                
                let csvdata = e.target.result; 
                parseCsv.getParsecsvdata(csvdata); // calling function for parse csv data 
                context.resetFileState();
            });
            
            reader.readAsBinaryString(myFile);
        }
      });
    }
    uploadDealcsv.prototype.getParsecsvdata = function(data) {
      const genesets = {};

      let newLinebrk = data.split("\n");
      if (newLinebrk.at(-1)===""){
        newLinebrk = newLinebrk.slice(0,-1)
      }

      for(let i = 0; i < newLinebrk.length; i++) {
        const y = newLinebrk[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
        const x = [];
        y.forEach((item)=>{
          if (item.startsWith("\"") && item.endsWith("\"")){
            x.push(item.substring(1,item.length-1).split("\r").at(0))
          } else {
            x.push(item.split("\r").at(0))
          }
        })
        if (x[0] === "gene_set_description" && x[1] === "gene_set_name"){
          continue;
        }
        const suffix = x[2]==="True" ? "" : "";
        if (`${x[0]}${suffix}` in genesets) {
          genesets[`${x[0]}${suffix}`][x[1]] = x.slice(3)
        } else {
          genesets[`${x[0]}${suffix}`]={}
          genesets[`${x[0]}${suffix}`][x[1]] = x.slice(3)
        }
      }
      for (const key1 in genesets) {
        for (const key2 in genesets[key1]) {
          dispatch({
            type: "geneset: create",
            genesetName: key2,
            genesetDescription: key1,
          });
          dispatch(actions.genesetAddGenes(key1, key2, genesets[key1][key2]));  
        }
      }
  

    }
    var parseCsv = new uploadDealcsv();
    parseCsv.getCsv();
  }

  resetFileState = () => {
    this.setState({...this.state, 
      fileName: "Choose file...", 
      uploadMetadataOpen: false,
    })
  }

  setupFileInput2 = () => {
    const { dispatch, annoMatrix } = this.props;
    const context = this;
    function uploadDealcsv () {};
    uploadDealcsv.prototype.getCsv = function(e) {
      let input = document.getElementById('dealCsv3');
      input.addEventListener('change', function() {
        if (this.files && this.files[0]) {

            var myFile = this.files[0];
            const formData = new FormData();
            formData.append("file",myFile);
            fetch(`${globals.API.prefix}${globals.API.version}uploadVarMetadata`, {method: "POST", body: formData}).then((res)=>{
              res.json().then((schema)=>{
                annoMatrix.updateSchema(schema.schema)
                dispatch({type: "refresh var metadata"})
                context.resetFileState2();
              })

              
            });            
        }
      });
    }
    var parseCsv = new uploadDealcsv();
    parseCsv.getCsv();
  }

  resetFileState2 = () => {
    this.setState({...this.state, 
      fileName2: "Choose file...", 
      uploadMetadataOpen2: false,
    })
  }

  renderGeneSets = (isGenes=false) => {
    if (isGenes) {
      const { allGenes, rightWidth, cxgMode } = this.props;
      const name = cxgMode==="OBS" ? `All genes` : `All cells`
      return (
        <GeneSet
          key={name}
          setGenes={allGenes}
          displayLabel={name}
          setName={name}
          allGenes
          rightWidth={rightWidth}
        />
      );  
    }
    const { dispatch, genesets, rightWidth, cxgMode } = this.props;    
    const cOrG = cxgMode==="OBS" ? `gene` : `cell`    

    const nogroups = [];
    if ("" in genesets) {
      for (const name in genesets[""]) {
        nogroups.push(
          <GeneSet
            key={name}
            setGenes={genesets[""][name]}
            displayLabel={name}
            setName={name}
            genesetDescription={""}
            rightWidth={rightWidth}
          />
        );        
      }
    }

    const sets = {};
    const sets2 = {};
    for (const group in genesets) {
      if (group !== "") {
        for (const name in genesets[group]) {
          const set = (
            <GeneSet
              key={name}
              setGenes={genesets[group][name]}
              displayLabel={name}
              setName={name}
              genesetDescription={group}
              rightWidth={rightWidth}
            />
          );

          if (!group.includes("//;;//")){
            if ( group in sets ){
              sets[group].push(set)
            } else {
              sets[group] = [set]
            } 
          } else {
            if ( group in sets2 ){
              sets2[group].push(set)
            } else {
              sets2[group] = [set]
            }             
          }
        }
      }
    }

    const els = [];
    let count = 0;
    for ( const key in sets ){
      const groupName = key;
      count += 1;
      
      const style = count > 1 ? {borderLeft: "1px solid black",
                                 borderRight: "1px solid black",
                                 borderBottom: "1px solid black"} : {border: "1px solid black"}
      els.push(
        <div key={key} style={style}>
            <div style={{
              display: "flex",
              backgroundColor: "#F0F0F0",
            }}>
            <AnchorButton
              onClick={() => {
                this.setState({ 
                  [groupName]: !(this.state[groupName]??false)
                });
              }}
              text={<Truncate><span>{groupName}</span></Truncate>}
              fill
              minimal
              rightIcon={(this.state[groupName]??false) ? "chevron-down" : "chevron-right"} small
            />  
            <Tooltip
            content={`Edit ${cOrG} set group name`}
            position="top"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}            
            >             
            <AnchorButton
              icon={<Icon icon="edit" iconSize={10} />}     
              minimal
              style={{
                cursor: "pointer",
              }}
              onClick={(e) => this.activateEditNameMode(e,groupName)}
              />  
            </Tooltip>                 
            <Tooltip
            content={`Delete ${cOrG} set group`}
            position="top"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}            
            >
            <AnchorButton
              icon={<Icon icon="trash" iconSize={10} />}     
              minimal
              intent="danger"
              style={{
                cursor: "pointer",
              }}
              onClick={() => {
                dispatch(actions.genesetDeleteGroup(key))
              }}
            />    
            </Tooltip>                        
          </div>         
          <Collapse isOpen={this.state[groupName]??false}>
            {sets[key]}
          </Collapse>
        </div>
      )
    }

    const els2 = [];
    count = 0;
    for ( const key in sets2 ){
      const groupName = key;
      count += 1;
      
      const style = count > 1 ? {borderLeft: "1px solid black",
                                 borderRight: "1px solid black",
                                 borderBottom: "1px solid black"} : {border: "1px solid black"}
      els2.push(
        <div key={key} style={style}>
            <div style={{
              display: "flex",
              backgroundColor: "#F0F0F0",
            }}>
            <AnchorButton
              onClick={() => {
                this.setState({ 
                  [groupName]: !(this.state[groupName]??false)
                });
              }}
              text={<Truncate><span>{groupName.split('//;;//').at(0)}</span></Truncate>}
              fill
              minimal
              rightIcon={(this.state[groupName]??false) ? "chevron-down" : "chevron-right"} small
            />  
            <Tooltip
            content={`Edit ${cOrG} set group name`}
            position="top"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}            
            >             
            <AnchorButton
              icon={<Icon icon="edit" iconSize={10} />}     
              minimal
              style={{
                cursor: "pointer",
              }}
              onClick={(e) => this.activateEditNameMode(e,groupName)}
              />  
            </Tooltip>                 
            <Tooltip
            content={`Delete ${cOrG} set group`}
            position="top"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}            
            >
            <AnchorButton
              icon={<Icon icon="trash" iconSize={10} />}     
              minimal
              intent="danger"
              style={{
                cursor: "pointer",
              }}
              onClick={() => {
                dispatch(actions.genesetDeleteGroup(key))
                dispatch(actions.requestDiffDelete(key))
              }}
            />    
            </Tooltip>                        
          </div>         
          <Collapse isOpen={this.state[groupName]??false}>
            {sets2[key]}
          </Collapse>
        </div>
      )
    }    
    return [nogroups, els, els2];      
  };
  
  handleSaveGenedata = () => {
    const { dispatch } = this.props;
    dispatch(actions.downloadGenedata())
  } 

  handleExpandGeneSets = () => {
    this.setState({
      ...this.state,
      geneSetsExpanded: !this.state.geneSetsExpanded,
    });
  };


  handleActivateCreateGenesetMode = () => {
    const { dispatch } = this.props;
    dispatch({ type: "geneset: activate add new geneset mode" });
  };

  render() {
    const { dispatch, genesets, annoMatrix, userLoggedIn, var_keys, outputController, cxgMode } = this.props;
    const { geneSetsExpanded, isEditingSetName, newNameText, nameBeingEdited, varMetadata, uploadMetadataOpen, fileName, uploadMetadataOpen2, fileName2 } = this.state;
    const [nogroupElements,genesetElements,diffExpElements]=this.renderGeneSets();
    const saveLoading = !!outputController?.pendingFetch;
    const cOrG = cxgMode === "OBS" ? "gene" : "cell";
    return (
      <div>
       {userLoggedIn ?  <GenesetHotkeys
          dispatch={dispatch}
          genesets={genesets}
        /> : null}

     
            <div style={{
              marginBottom: "20px",
              display: "flex",
              justifyContent: "right",
              columnGap: "10px"
            }}>   
            {/*<span style={{margin: "auto 0", paddingRight: "10px"}}>
            <b>{"Expression options:"}</b>
            </span>*/}    
            <ParameterInput
              label="Scale genes"
              param="scaleExpr"
              tooltipContent={"Check to standardize gene expression across cells."}
              left
            />               
            <ParameterInput
              label="Log scale"
              param="logScaleExpr"
              tooltipContent={"Check to display expressions in log scale."}
              left
            />   
          <div style={{paddingLeft: "10px"}}>
            <ParameterInput
              label="Data layer"
              param="dataLayerExpr"
              options={annoMatrix.schema.layers}
              tooltipContent={"Expression layer used for visualization and differential expression."}
              left
            /> 
          </div>             
        </div>  
        <div style={{
          textAlign: "right",
          justifyContent: "right",
          paddingBottom: "10px"
        }}>         
            <Tooltip
            content="Save gene metadata to a `.txt` file."
            position="bottom"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}
          >                                              
            <AnchorButton
                type="button"
                loading={saveLoading}
                icon="floppy-disk"
                onClick={() => {
                  dispatch(actions.downloadVarMetadata())
                }}
              /> 
            </Tooltip>           
            <Tooltip
            content="Upload gene metadata from a tab-delimited .txt file."
            position="bottom"
            hoverOpenDelay={globals.tooltipHoverOpenDelay}
          >                                              
            <AnchorButton
                type="button"
                icon="upload"
                disabled={!userLoggedIn}
                onClick={() => {
                  this.setState({...this.state,uploadMetadataOpen2: true})
                }}
              /> 
            </Tooltip>                 
              <Dialog
                title="Upload gene metadata file (tab-delimited, .txt)."
                isOpen={uploadMetadataOpen2}
                onOpened={()=>this.setupFileInput2()}
                onClose={()=>{
                  this.resetFileState2();
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
                    <input type="file" id="dealCsv3"/>
                    <span className="bp3-file-upload-input">{fileName2}</span>
                  </label>           
                </div>                                
              </Dialog> 
                      
          {var_keys.length > 0 && <Tooltip
                content={"The gene metadata to display."}
                position={Position.RIGHT}
                hoverOpenDelay={globals.tooltipHoverOpenDelay}
                modifiers={{
                  preventOverflow: { enabled: false },
                  hide: { enabled: false },
                }}
              >   
                <Select
                items={
                  var_keys
                }
                filterable={false}
                itemRenderer={(d, { handleClick }) => {
                  return (
                    <MenuItem
                      onClick={handleClick}
                      key={d}
                      text={d}
                    />
                  );
                }}
                onItemSelect={(d) => {
                  this.setState({
                    ...this.state,
                    varMetadata: d
                  })
                  dispatch({type: "set var key", key: d})                  
                }}
              >
                <AnchorButton
                  text={`Metadata: ${varMetadata}`}
                  rightIcon="double-caret-vertical"
                />
              </Select>
            </Tooltip>}
            </div>                                   
        <div style={{
          paddingTop: "10px",
          paddingBottom: "20px"
        }}>
          {this.renderGeneSets(true)}
        </div>      
        {userLoggedIn && <div>
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between" }}>
            <H4
              role="menuitem"
              tabIndex="0"
              data-testclass="geneset-heading-expand"
              style={{
                cursor: "pointer",
              }}
              onClick={this.handleExpandGeneSets}
            >
              {`${cOrG[0].toUpperCase() + cOrG.slice(1)} Sets `}
              {geneSetsExpanded ? (
                <Icon icon={IconNames.CHEVRON_DOWN} />
              ) : (
                <Icon icon={IconNames.CHEVRON_RIGHT} />
              )}
            </H4>        
            <div style={{
              marginBottom: 10, position: "relative", top: -2
            }}>
              <div style={{
                  display: "flex",
                  justifyContent: "left",
                  textAlign: "left", 
                  float: "left",
                  paddingRight: "10px"
                }}>
                            
                  {userLoggedIn && <Tooltip
                    content={`Save ${cOrG} sets a \`.csv\` file.`}
                    position="bottom"
                    hoverOpenDelay={globals.tooltipHoverOpenDelay}
                  >                                              
                    <AnchorButton
                        type="button"
                        icon="floppy-disk"
                        onClick={() => {
                          this.handleSaveGenedata()
                        }}
                      /> 
                    </Tooltip> }
                <Tooltip
                content={`Upload ${cOrG} sets from a \`.csv\`, comma-delimited file.`}
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
                    title={`Upload ${cOrG} sets file (comma-delimited .csv)`}
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
                        <input type="file" id="dealCsv2"/>
                        <span className="bp3-file-upload-input">{fileName}</span>
                      </label>           
                    </div>                                
                  </Dialog>                       
                  </div>               
            <Button
              data-testid="open-create-geneset-dialog"
              onClick={this.handleActivateCreateGenesetMode}
              intent="primary"
              disabled={!userLoggedIn}
            >
              Create new
            </Button>
            </div>    
          </div>
          <CreateGenesetDialogue />

          { 
            geneSetsExpanded && <div>
              {(nogroupElements.length > 0) && <div style={{paddingBottom: "5px"}}>
                <b>Ungrouped {cOrG} sets</b>
              </div>}              
              {nogroupElements}
              {(genesetElements.length > 0) && <div style={{paddingBottom: "5px"}}>
                <b>Grouped {cOrG} sets</b>
              </div> }                         
              {genesetElements}
              {(diffExpElements.length > 0) && <div style={{paddingBottom: "5px",paddingTop: "5px"}}>
                <b>Differential expression {cOrG} sets</b>
              </div> }                         
              {diffExpElements}              
              </div>
              
          }
        </div>}
        {userLoggedIn && <AnnoDialog
          isActive={
            isEditingSetName
          }
          inputProps={{
            "data-testid": `edit-set-name-dialog`,
          }}
          primaryButtonProps={{
            "data-testid": `submit-set-name-edit`,
          }}
          title={`Edit ${cOrG} set group name`}
          instruction={`Choose a new ${cOrG} set group name`}
          cancelTooltipContent="Close this dialog without editing the name."
          primaryButtonText={`Edit ${cOrG} set group name`}
          text={newNameText}
          handleSubmit={this.handleEditName}
          handleCancel={this.disableEditNameMode}
          validationError={newNameText===nameBeingEdited}
          allowEmpty
          annoInput={
            <LabelInput
              label={newNameText.split('//;;//').at(0)}
              inputProps={{
                "data-testid": `edit-set-name-text`,
                leftIcon: "tag",
                intent: "none",
                autoFocus: true,
              }}
              onChange={this.handleChangeOrSelect}
              onSelect={this.handleChangeOrSelect}                    
              newLabelMessage="New layout name"
            />
          }
        /> }      
      </div>
    );
  }
}

export default GeneExpression;
