import React from "react";
import { Button, Classes } from "@blueprintjs/core";
import { connect } from "react-redux";
import * as globals from "../../globals";

@connect((state) => {
  return {
    annoMatrix: state.annoMatrix,
  };
})
class VarMetadataUpload extends React.Component {

  setupFileInput = () => {
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
              })

              
            });            
        }
      });
    }
    var parseCsv = new uploadDealcsv();
    parseCsv.getCsv();
  }


  render() {
    return (
      <>
        <input type="file" id="dealCsv3" style={{display: "none"}}/>
        <Button minimal className={Classes.POPOVER_DISMISS} onClick={()=>{
          this.setupFileInput()
          const up = document.getElementById("dealCsv3")
          up.click();
        }}>
          Gene metadata
        </Button>  
      </> 
    );
  }
}

export default VarMetadataUpload;
