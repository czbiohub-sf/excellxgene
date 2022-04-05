import copy
import logging
import sys
from http import HTTPStatus
import zlib
import json
import pandas as pd
import numpy as np
from glob import glob
from flask import make_response, jsonify, current_app, abort, send_file, after_this_request, session
from werkzeug.urls import url_unquote
import shutil
from anndata import AnnData
import pickle
from backend.common.utils.type_conversion_utils import get_schema_type_hint_of_array
from backend.common.utils.data_locator import DataLocator
from backend.server.common.config.client_config import get_client_config, get_client_userinfo
from backend.common.constants import Axis, DiffExpMode, JSON_NaN_to_num_warning_msg
from backend.common.genesets import read_gene_sets_tidycsv
from backend.common.errors import (
    FilterError,
    JSONEncodingValueError,
    PrepareError,
    DisabledFeatureError,
    ExceedsLimitError,
    DatasetAccessError,
    ColorFormatException,
    AnnotationsError,
    ObsoleteRequest,
    UnsupportedSummaryMethod,
)
from backend.common.genesets import summarizeQueryHash
from backend.common.fbs.matrix import decode_matrix_fbs
import os 
import pathlib

def abort_and_log(code, logmsg, loglevel=logging.DEBUG, include_exc_info=False):
    """
    Log the message, then abort with HTTP code. If include_exc_info is true,
    also include current exception via sys.exc_info().
    """
    if include_exc_info:
        exc_info = sys.exc_info()
    else:
        exc_info = False
    current_app.logger.log(loglevel, logmsg, exc_info=exc_info)
    # Do NOT send log message to HTTP response.
    return abort(code)


def _query_parameter_to_filter(args):
    """
    Convert an annotation value filter, if present in the query args,
    into the standard dict filter format used by internal code.

    Query param filters look like:  <axis>:name=value, where value
    may be one of:
        - a range, min,max, where either may be an open range by using an asterisk, eg, 10,*
        - a value
    Eg,
        ...?tissue=lung&obs:tissue=heart&obs:num_reads=1000,*
    """
    filters = {
        "obs": {},
        "var": {},
    }

    # args has already been url-unquoted once.  We assume double escaping
    # on name and value.
    try:
        for key, value in args.items(multi=True):
            axis, name = key.split(":")
            if axis not in ("obs", "var"):
                raise FilterError("unknown filter axis")
            name = url_unquote(name)
            current = filters[axis].setdefault(name, {"name": name})

            val_split = value.split(",")
            if len(val_split) == 1:
                if "min" in current or "max" in current:
                    raise FilterError("do not mix range and value filters")
                value = url_unquote(value)
                values = current.setdefault("values", [])
                values.append(value)

            elif len(val_split) == 2:
                if len(current) > 1:
                    raise FilterError("duplicate range specification")
                min = url_unquote(val_split[0])
                max = url_unquote(val_split[1])
                if min != "*":
                    current["min"] = float(min)
                if max != "*":
                    current["max"] = float(max)
                if len(current) < 2:
                    raise FilterError("must specify at least min or max in range filter")

            else:
                raise FilterError("badly formated filter value")

    except ValueError as e:
        raise FilterError(str(e))

    result = {}
    for axis in ("obs", "var"):
        axis_filter = filters[axis]
        if len(axis_filter) > 0:
            result[axis] = {"annotation_value": [val for val in axis_filter.values()]}

    return result

def schema_get_helper(data_adaptor, userID = None):   
    if userID is None:
        userID = _get_user_id(data_adaptor)   
        
    if data_adaptor.data.raw is not None:
        layers = [".raw"]+list(data_adaptor.data.layers.keys())
    else:
        layers = list(data_adaptor.data.layers.keys())
    
    if "X" not in layers:
        layers = ["X"] + layers
    
    
    initial_embeddings = []
    for k in data_adaptor._obsm_init.keys():
        initial_embeddings.append(k if k[:2]!="X_" else k[2:])

    latent_spaces = []
    fns = glob(f"{userID}/pca/*.p")
    for f in fns:
        latent_spaces.append(f.split('/')[-1].split('\\')[-1][:-2])

    mode = userID.split("/")[-1].split("\\")[-1]
    schema = {
        "dataframe": {"nObs": data_adaptor.NAME[mode]["obs"].size, "nVar": data_adaptor.NAME[mode]["var"].size, "type": str(data_adaptor.data.X.dtype)},
        "annotations": {
            "obs": {"index": "name_0", "columns": []},
            "var": {"index": "name_0", "columns": []},
        },
        "layout": {"obs": []},
        "layers": layers,
        "latent_spaces": latent_spaces,
        "initial_embeddings": initial_embeddings,
        "rootName": data_adaptor.rootName
    }
    
    for ax in Axis:
        if str(ax) == "var":
            fns = glob(f"{userID}/var/*.p")
            for ann in fns:
                ann=ann.split('.p')[0].split('/')[-1].split('\\')[-1]
                if ann != "name_0":
                    x = pickle_loader(f"{userID}/var/{ann}.p")
                    a,c = np.unique(x,return_counts=True)
                    if a.size > 2000 or c.max() < 5:
                        ann_schema = {"name": ann, "writable": False}
                    else:
                        ann_schema = {"name": ann, "writable": True}
                    ann_schema.update(get_schema_type_hint_of_array(x))
                    schema["annotations"]["var"]["columns"].append(ann_schema)
            
            ann = "name_0"
            x = pickle_loader(f"{userID}/var/{ann}.p") 
            ann_schema = {"name": ann, "writable": False}
            ann_schema.update(get_schema_type_hint_of_array(x))
            schema["annotations"][ax]["columns"].append(ann_schema)
            
        elif str(ax) == "obs":
            fns = glob(f"{userID}/obs/*.p")
            for ann in fns:
                ann=ann.split('.p')[0].split('/')[-1].split('\\')[-1]
                if ann != "name_0":
                    x = pickle_loader(f"{userID}/obs/{ann}.p")
                    a,c = np.unique(x,return_counts=True)
                    if a.size > 2000 or c.max() < 5:
                        ann_schema = {"name": ann, "writable": False}
                    else:
                        ann_schema = {"name": ann, "writable": True}
                    ann_schema.update(get_schema_type_hint_of_array(x))
                    schema["annotations"][ax]["columns"].append(ann_schema)
            
            ann = "name_0"
            x = pickle_loader(f"{userID}/obs/{ann}.p") 
            ann_schema = {"name": ann, "writable": False}
            ann_schema.update(get_schema_type_hint_of_array(x))
            schema["annotations"][ax]["columns"].append(ann_schema)

    for layout in [x.split('/')[-1].split('\\')[-1][:-2] for x in glob(f"{userID}/emb/*.p")]:
        layout_schema = {"name": layout, "type": "float32", "dims": [f"{layout}_0", f"{layout}_1"]}
        schema["layout"]["obs"].append(layout_schema)
    return schema

def schema_get(data_adaptor):
    schema = schema_get_helper(data_adaptor)
    return make_response(jsonify({"schema": schema}), HTTPStatus.OK)

def gene_info_get(request,data_adaptor):
    gene = request.args.get("gene", None)
    varM = request.args.get("varM", None)    
    name = request.args.get("embName",None)
    userID = _get_user_id(data_adaptor)
     #direc    

    if varM is not None and gene is not None:
        try:
            X = pickle_loader(f"{userID}/var/{varM};;{name}.p")
        except:
            X = pickle_loader(f"{userID}/var/{varM}.p")
        n = pickle_loader(f"{userID}/var/name_0.p")                    
        return make_response(jsonify({"response": X[n==gene]}), HTTPStatus.OK)
    else:
        return make_response(jsonify({"response": "NaN"}), HTTPStatus.OK)

def reset_to_root_folder(request,data_adaptor):
    userID = _get_user_id(data_adaptor)
    src = data_adaptor.guest_idhash
    target = userID    
    os.system(f"rsync -a --recursive --delete {src}/ {target}")
    schema = schema_get_helper(data_adaptor)
    return make_response(jsonify({"schema": schema}), HTTPStatus.OK)    

def admin_restart_get(request,data_adaptor):
    assert(session['excxg_profile']['email']=='alexander.tarashansky@czbiohub.org')
    data_adaptor._reset_pool()
    return make_response(jsonify({"reset": True}), HTTPStatus.OK)

def gene_info_bulk_put(request,data_adaptor):
    args = request.get_json()
    geneSet = args['geneSet']
    varM = args['varMetadata']
    name = args.get("embName",None)
    userID = _get_user_id(data_adaptor)
     #direc  

    if varM != "":
        try:
            X = pickle_loader(f"{userID}/var/{varM};;{name}.p")
        except:
            X = pickle_loader(f"{userID}/var/{varM}.p")
        n = pickle_loader(f"{userID}/var/name_0.p")   

        return make_response(jsonify({"response": list(pd.Series(data=X,index=n)[geneSet].values)}), HTTPStatus.OK)
    else:
        return make_response(jsonify({"response": "ok"}), HTTPStatus.OK)        

def config_get(app_config, data_adaptor):
    config = get_client_config(app_config, data_adaptor)
    return make_response(jsonify(config), HTTPStatus.OK)


def userinfo_get(app_config, data_adaptor):
    config = get_client_userinfo(app_config, data_adaptor)
    return make_response(jsonify(config), HTTPStatus.OK)


def _get_obs_keys(data_adaptor):
    userID = _get_user_id(data_adaptor)
    fns = glob(f"{userID}/obs/*.p")
    return [ann.split('.p')[0].split('/')[-1].split('\\')[-1] for ann in fns]

def _get_var_keys(data_adaptor):
    userID = _get_user_id(data_adaptor)
    fns = glob(f"{userID}/var/*.p")
    return [ann.split('.p')[0].split('/')[-1].split('\\')[-1] for ann in fns]

def annotations_obs_get(request, data_adaptor):
    fields = request.args.getlist("annotation-name", None)
    num_columns_requested = len(_get_obs_keys(data_adaptor)) if len(fields) == 0 else len(fields)
    if data_adaptor.server_config.exceeds_limit("column_request_max", num_columns_requested):
        return abort(HTTPStatus.BAD_REQUEST)
    preferred_mimetype = request.accept_mimetypes.best_match(["application/octet-stream"])
    if preferred_mimetype != "application/octet-stream":
        return abort(HTTPStatus.NOT_ACCEPTABLE)
    
    try:
        labels = None
        annotations = data_adaptor.dataset_config.user_annotations
        if annotations.user_annotations_enabled():
            userID = _get_user_id(data_adaptor)
            name_0 = pickle_loader(f"{userID}/obs/name_0.p")
            labels=pd.DataFrame()
            for f in fields:
                labels[f] = pickle_loader(f"{userID}/obs/{f}.p")
            labels.index = pd.Index(name_0,dtype='object')
        fbs = data_adaptor.annotation_to_fbs_matrix(Axis.OBS, fields, labels)
        return make_response(fbs, HTTPStatus.OK, {"Content-Type": "application/octet-stream"})
    except KeyError as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)

def annotations_var_get(request, data_adaptor):
    fields = request.args.getlist("annotation-name", None)
    name = request.args.get("embName", None)

    num_columns_requested = len(_get_var_keys(data_adaptor)) if len(fields) == 0 else len(fields)
    if data_adaptor.server_config.exceeds_limit("column_request_max", num_columns_requested):
        return abort(HTTPStatus.BAD_REQUEST)
    preferred_mimetype = request.accept_mimetypes.best_match(["application/octet-stream"])
    if preferred_mimetype != "application/octet-stream":
        return abort(HTTPStatus.NOT_ACCEPTABLE)

    try:
        labels = None
        annotations = data_adaptor.dataset_config.user_annotations
        if annotations.user_annotations_enabled():
            userID = _get_user_id(data_adaptor)
            name_0 = pickle_loader(f"{userID}/var/name_0.p")
            labels=pd.DataFrame()
            for f in fields:
                try:
                    labels[f] = pickle_loader(f"{userID}/var/{f};;{name}.p")
                except:
                    labels[f] = pickle_loader(f"{userID}/var/{f}.p")
            labels.index = pd.Index(name_0,dtype='object')
        fbs = data_adaptor.annotation_to_fbs_matrix(Axis.VAR, fields, labels)
        return make_response(fbs, HTTPStatus.OK, {"Content-Type": "application/octet-stream"})
    except KeyError as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)

def annotations_var_put(request, data_adaptor):
    annotations = data_adaptor.dataset_config.user_annotations
    if not annotations.user_annotations_enabled():
        return abort(HTTPStatus.NOT_IMPLEMENTED)

    anno_collection = request.args.get("annotation-collection-name", default=None)
    name = request.args.get("embName", default=None)
    fbs = inflate(request.get_data())

    if anno_collection is not None:
        if not annotations.is_safe_collection_name(anno_collection):
            return abort(HTTPStatus.BAD_REQUEST, "Bad annotation collection name")
        annotations.set_collection(anno_collection)

    try:
        annotations_put_fbs_helper_var(data_adaptor, fbs, name)
        res = json.dumps({"status": "OK"})
        return make_response(res, HTTPStatus.OK, {"Content-Type": "application/json"})
    except (ValueError, DisabledFeatureError, KeyError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)


def pickle_dumper(x,fn):
    with open(fn,"wb") as f:
        pickle.dump(x,f)

def pickle_loader(fn):
    with open(fn,"rb") as f:
        x = pickle.load(f)
    return x

def annotations_put_fbs_helper(data_adaptor, fbs): 
    """helper function to write annotations from fbs"""
    annotations = data_adaptor.dataset_config.user_annotations
    if not annotations.user_annotations_enabled():
        raise DisabledFeatureError("Writable annotations are not enabled")

    new_label_df = decode_matrix_fbs(fbs)
    if not new_label_df.empty:
        new_label_df = data_adaptor.check_new_labels(new_label_df)
    if not new_label_df.empty:
        annotations_put_worker(data_adaptor,new_label_df)

def annotations_put_worker(data_adaptor, new_label_df, userID=None, initVar = False):
    if userID is None:
        userID = _get_user_id(data_adaptor)
    ID = userID.split('/')[0].split('\\')[0]
    mode = userID.split('/')[-1].split('\\')[-1]
    otherMode = "OBS" if mode == "VAR" else "VAR"
    pathNew = ID+"/"+otherMode
    for col in new_label_df:
        vals = np.array(list(new_label_df[col]))
        if isinstance(vals[0],np.integer):
            if (len(set(vals))<500):
                vals = vals.astype('str')            
        src = "{}/obs/{}.p".format(userID,col.replace('/','_'))
        tgt = "{}/var/{}.p".format(pathNew,col.replace('/','_'))
        pickle_dumper(vals,src)

        if data_adaptor._joint_mode or initVar:
            if initVar:
                pickle_dumper(vals,tgt)

            name = data_adaptor.NAME[mode]["obs"]
            
            dtype = vals.dtype
            dtype_name = dtype.name
            dtype_kind = dtype.kind
            a,c = np.unique(vals,return_counts=True)
            flag =  a.size > 2000 or c.max() < 5
            if not flag and (dtype_name == "object" and dtype_kind == "O" or dtype.type is np.str_ or dtype.type is np.string_):  
                d = _df_to_dict(vals,name)
                try:
                    del d['unassigned']
                except:
                    pass            
                
                if os.path.exists(f"{pathNew}/set/{col}/"):
                    shutil.rmtree(f"{pathNew}/set/{col}/")            
                os.makedirs(f"{pathNew}/set/{col}/")
                for dkey in d:
                    pickle_dumper(d[dkey],f"{pathNew}/set/{col}/{dkey}.p")    

def annotations_put_fbs_helper_var(data_adaptor, fbs, name):
    """helper function to write annotations from fbs"""
    annotations = data_adaptor.dataset_config.user_annotations
    if not annotations.user_annotations_enabled():
        raise DisabledFeatureError("Writable annotations are not enabled")

    new_label_df = decode_matrix_fbs(fbs)
    if not new_label_df.empty:
        new_label_df = check_new_labels_var(new_label_df)
    if not new_label_df.empty:
        userID = _get_user_id(data_adaptor)
        for col in new_label_df:
            pickle_dumper(np.array(list(new_label_df[col]),dtype='object'),"{}/var/{};;{}.p".format(userID,col.replace('/','_'),name))

def check_new_labels_var(self, labels_df):
    """Check the new annotations labels, then set the labels_df index"""
    if labels_df is None or labels_df.empty:
        return

    labels_df.index = self.get_var_index()
    if labels_df.index.name is None:
        labels_df.index.name = "index"

    # all labels must have a name, which must be unique and not used in obs column names
    if not labels_df.columns.is_unique:
        raise KeyError("All column names specified in user annotations must be unique.")

    # the label index must be unique, and must have same values the anndata obs index
    if not labels_df.index.is_unique:
        raise KeyError("All row index values specified in user annotations must be unique.")

    # labels must have same count as obs annotations
    shape = self.get_shape()
    if labels_df.shape[0] != shape[0]:
        raise ValueError("Labels file must have same number of rows as data file.")

    # This will convert a float column that contains integer data into an integer type.
    # This case can occur when a user makes a copy of a category that originally contained integer data.
    # The client always copies array data to floats, therefore the copy will contain floats instead of integers.
    # float data is not allowed as a categorical type.
    if any([np.issubdtype(coltype.type, np.floating) for coltype in labels_df.dtypes]):
        labels_df = labels_df.convert_dtypes()
        for col, dtype in zip(labels_df, labels_df.dtypes):
            if isinstance(dtype, pd.Int32Dtype):
                labels_df[col] = labels_df[col].astype("int32")
            if isinstance(dtype, pd.Int64Dtype):
                labels_df[col] = labels_df[col].astype("int64")
    
    return labels_df

def inflate(data):
    return zlib.decompress(data)


def annotations_obs_put(request, data_adaptor):
    annotations = data_adaptor.dataset_config.user_annotations
    if not annotations.user_annotations_enabled():
        return abort(HTTPStatus.NOT_IMPLEMENTED)

    anno_collection = request.args.get("annotation-collection-name", default=None)
    fbs = inflate(request.get_data())

    if anno_collection is not None:
        if not annotations.is_safe_collection_name(anno_collection):
            return abort(HTTPStatus.BAD_REQUEST, "Bad annotation collection name")
        annotations.set_collection(anno_collection)

    try:
        annotations_put_fbs_helper(data_adaptor, fbs)
        res = json.dumps({"status": "OK"})
        return make_response(res, HTTPStatus.OK, {"Content-Type": "application/json"})
    except (ValueError, DisabledFeatureError, KeyError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)


def data_var_put(request, data_adaptor):
    preferred_mimetype = request.accept_mimetypes.best_match(["application/octet-stream"])
    if preferred_mimetype != "application/octet-stream":
        return abort(HTTPStatus.NOT_ACCEPTABLE)

    args = request.get_json()
    filter = args.get("filter",None)
    layer = args.get("layer","X")
    logscale = args.get("logscale","false")=="true"
    scale = args.get("scale","false")=="true"

    userID = _get_user_id(data_adaptor).split('/')[0].split('\\')[0]
    mode=pickle.load(open(f"{userID}/mode.p",'rb'))
    try:
        return make_response(
            data_adaptor.data_frame_to_fbs_matrix(filter, axis=Axis.VAR,layer=layer,logscale=logscale,scale=scale,mode=mode),
            HTTPStatus.OK,
            {"Content-Type": "application/octet-stream"},
        )
    except (FilterError, ValueError, ExceedsLimitError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)


def data_var_get(request, data_adaptor):
    preferred_mimetype = request.accept_mimetypes.best_match(["application/octet-stream"])
    if preferred_mimetype != "application/octet-stream":
        return abort(HTTPStatus.NOT_ACCEPTABLE)
    
    userID = _get_user_id(data_adaptor).split('/')[0].split('\\')[0]
    mode=pickle.load(open(f"{userID}/mode.p",'rb'))
    
    try:
        layer = request.values.get("layer", default="X")
        logscale = request.values.get("logscale", default="false") == "true"
        scale = request.values.get("scale", default="false") == "true"
        args_filter_only = request.args.copy()
        args_filter_only.poplist("layer")  
        args_filter_only.poplist("logscale")     
        args_filter_only.poplist("scale")        
        filter = _query_parameter_to_filter(args_filter_only)
        return make_response(
            data_adaptor.data_frame_to_fbs_matrix(filter, axis=Axis.VAR, layer=layer, logscale=logscale, scale=scale, mode=mode),
            HTTPStatus.OK,
            {"Content-Type": "application/octet-stream"},
        )
    except (FilterError, ValueError, ExceedsLimitError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)

def colors_get(data_adaptor):
    """
    if not data_adaptor.dataset_config.presentation__custom_colors:
        return make_response(jsonify({}), HTTPStatus.OK)
    try:
        return make_response(jsonify(data_adaptor.get_colors()), HTTPStatus.OK)
    except ColorFormatException as e:
        return abort_and_log(HTTPStatus.NOT_FOUND, str(e), include_exc_info=True)
    """
    return make_response(jsonify({}), HTTPStatus.OK)

def diffexp_obs_post(data, data_adaptor):
    if not data_adaptor.dataset_config.diffexp__enable:
        return abort(HTTPStatus.NOT_IMPLEMENTED)

    args = data.get_json()
    try:
        # TODO: implement varfilter mode
        mode = DiffExpMode(args["mode"])

        if mode == DiffExpMode.VAR_FILTER or "varFilter" in args:
            return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, "varFilter not enabled")

        set1_filter = args.get("set1", {"filter": {}})["filter"]
        set2_filter = args.get("set2", {"filter": {}})["filter"]
        count = args.get("count", None)

        if set1_filter is None or set2_filter is None or count is None:
            return abort_and_log(HTTPStatus.BAD_REQUEST, "missing required parameter")
        if Axis.VAR in set1_filter or Axis.VAR in set2_filter:
            return abort_and_log(HTTPStatus.BAD_REQUEST, "var axis filter not enabled")

    except (KeyError, TypeError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)

    try:
        diffexp = data_adaptor.diffexp_topN(set1_filter, set2_filter, count)
        return make_response(diffexp, HTTPStatus.OK, {"Content-Type": "application/json"})
    except (ValueError, DisabledFeatureError, FilterError, ExceedsLimitError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)
    except JSONEncodingValueError:
        # JSON encoding failure, usually due to bad data. Just let it ripple up
        # to default exception handler.
        current_app.logger.warning(JSON_NaN_to_num_warning_msg)
        raise  

def layout_obs_get(request, data_adaptor):
    fields = request.args.getlist("layout-name", None)
    num_columns_requested = len(data_adaptor.get_embedding_names()) if len(fields) == 0 else len(fields)
    if data_adaptor.server_config.exceeds_limit("column_request_max", num_columns_requested):
        return abort(HTTPStatus.BAD_REQUEST)

    preferred_mimetype = request.accept_mimetypes.best_match(["application/octet-stream"])
    if preferred_mimetype != "application/octet-stream":
        return abort(HTTPStatus.NOT_ACCEPTABLE)

    try:
        return make_response(
            data_adaptor.layout_to_fbs_matrix(fields), HTTPStatus.OK, {"Content-Type": "application/octet-stream"}
        )
    except (KeyError, DatasetAccessError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)
    except PrepareError:
        return abort_and_log(
            HTTPStatus.NOT_IMPLEMENTED,
            f"No embedding available {request.path}",
            loglevel=logging.ERROR,
            include_exc_info=True,
        )

def layout_obs_get_joint(request, data_adaptor):
    fields = request.args.getlist("layout-name", None)
    num_columns_requested = len(data_adaptor.get_embedding_names()) if len(fields) == 0 else len(fields)
    if data_adaptor.server_config.exceeds_limit("column_request_max", num_columns_requested):
        return abort(HTTPStatus.BAD_REQUEST)

    preferred_mimetype = request.accept_mimetypes.best_match(["application/octet-stream"])
    if preferred_mimetype != "application/octet-stream":
        return abort(HTTPStatus.NOT_ACCEPTABLE)

    try:
        return make_response(
            data_adaptor.layout_to_fbs_matrix_joint(fields), HTTPStatus.OK, {"Content-Type": "application/octet-stream"}
        )
    except (KeyError, DatasetAccessError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)
    except PrepareError:
        return abort_and_log(
            HTTPStatus.NOT_IMPLEMENTED,
            f"No embedding available {request.path}",
            loglevel=logging.ERROR,
            include_exc_info=True,
        )

def sankey_data_put(request, data_adaptor):
    args = request.get_json()
    labels = args.get("labels", None)
    name = args.get("name", None)
    filter = args.get("filter",None)

    if not labels:
        return make_response(jsonify({"edges":[],"weights":[]}),HTTPStatus.OK, {"Content-Type": "application/json"})
    

    try:
        userID = _get_user_id(data_adaptor)          
        edges,weights = data_adaptor.compute_sankey_df(labels,name,filter, userID)
        edges = [list(x) for x in edges]
        weights = list(weights)
        return make_response(jsonify({"edges": edges, "weights": weights}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)


def upload_var_metadata_post(request, data_adaptor):
    file = request.files['file']
     #direc
    userID = _get_user_id(data_adaptor)         
    filename = file.filename.split('/')[-1].split('\\')[-1]
    file.save(f"{userID}/{filename}")
    A = pd.read_csv(f"{userID}/{filename}",sep='\t',index_col=0)
    v1 = np.array(list(A.index))    
    v2 = np.array(list(pickle_loader(f"{userID}/var/name_0.p")))
    filt = np.in1d(v1,v2)
    v1 = v1[filt]    
    assert v1.size > 0
    mode = userID.split('/')[-1].split('\\')[-1]
    ID = userID.split('/')[0].split('\\')[0]
    otherMode = "VAR" if mode == "OBS" else "OBS"
    ID+="/"+otherMode
    v2rev = v2[np.in1d(v2,v1,invert=True)]
    for k in A.columns:
        vals = np.array(list(A[k]))[filt].astype('object')
        if isinstance(vals[0],str):
            filler = "nan"
        else:
            filler = 0
        valsrev = np.zeros(v2rev.size,dtype='object')
        valsrev[:] = filler
        vals = np.array(list(pd.Series(index=np.append(v1,v2rev),data=np.append(vals,valsrev))[v2].values)).astype('object')
        pickle_dumper(vals,"{}/var/{}.p".format(userID,k.replace('/','_')))
        pickle_dumper(vals,"{}/obs/{}.p".format(ID,k.replace('/','_')))

    @after_this_request
    def remove_file(response):
        try:
            os.remove(f"{userID}/{filename}")
        except Exception as error:
            print(error)
        return response    
    schema = schema_get_helper(data_adaptor)
    return make_response(jsonify({"schema": schema}), HTTPStatus.OK)

def save_var_metadata_put(request, data_adaptor):
    args = request.get_json()
    embName = args['embName']

     #direc
    userID = _get_user_id(data_adaptor)        

    fnames = glob(f"{userID}/var/*.p")
    v = pickle_loader(f"{userID}/var/name_0.p")
    var=pd.DataFrame(data=v[:,None],index=v,columns=["name_0"])
    for f in fnames:
        n = f.split('/')[-1].split('\\')[-1][:-2]
        if ';;' in n:
            tlay = n.split(';;')[-1]
        else:
            tlay = ""
        if embName == tlay:
            l = pickle_loader(f"{userID}/var/{n}.p")
            if n != "name_0":
                var[n.split(';;')[0]] = pd.Series(data=l,index=v)  

    vkeys = list(var.keys())
    for f in fnames:
        n = f.split('/')[-1].split('\\')[-1][:-2]
        if ';;' not in n:
            if n not in vkeys:
                l = pickle_loader(f"{userID}/var/{n}.p")
                if n != "name_0":
                    var[n] = pd.Series(data=l,index=v)                   
    del var['name_0']    
    var.to_csv(f"{userID}/output/var.txt",sep='\t')

    @after_this_request
    def remove_file(response):
        try:
            os.remove(f"{userID}/output/var.txt")
        except Exception as error:
            print(error)
        return response

    try:
        direc = pathlib.Path().absolute()
        return send_file(f"{direc}/{userID}/output/var.txt",as_attachment=True)

    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)  


def save_metadata_put(request, data_adaptor):
    args = request.get_json()
    labelNames = args.get("labelNames",None)
    filter = args["filter"] if args else None
    
    try:
        shape = data_adaptor.get_shape()
        obs_mask = data_adaptor._axis_filter_to_mask(Axis.OBS, filter["obs"], shape[0])
    except (KeyError, IndexError):
        raise FilterError("Error parsing filter")

    userID = _get_user_id(data_adaptor)        

    labels = pd.DataFrame()
    for k in labelNames:
        labels[k] = pickle_loader(f"{userID}/obs/{k}.p")
    
    mode=userID.split('/')[-1].split('\\')[-1]
    labels.index = pd.Index(data_adaptor.NAME[mode]["obs"])
    labels = labels[obs_mask]
    labels.to_csv(f"{userID}/output/obs.txt",sep='\t')

    @after_this_request
    def remove_file(response):
        try:
            os.remove(f"{userID}/output/obs.txt")
        except Exception as error:
            print(error)
        return response

    try:
        direc = pathlib.Path().absolute()
        return send_file(f"{direc}/{userID}/output/obs.txt",as_attachment=True)
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)  

def save_genedata_put(request, data_adaptor):
    userID = _get_user_id(data_adaptor)        
    genesets = {}
    for k in glob(f"{userID}/set/*"):
        kn = k.split('/')[-1].split('\\')[-1]
        kn = "" if kn == "__blank__" else kn
        genesets[kn] = {}
        for k2 in glob(f"{userID}/set/{kn}/*.p"):
            kn2 = k2.split('/')[-1].split('\\')[-1].split('.p')[0]
            genesets[kn][kn2] = pickle_loader(k2)
    
    annotations = data_adaptor.dataset_config.user_annotations  
    with open(f"{userID}/output/gene-sets.csv", "w", newline="") as f:
        f.write(annotations.gene_sets_to_csv(genesets)) 

    @after_this_request
    def remove_file(response):
        try:
            os.remove(f"{userID}/output/gene-sets.csv")
        except Exception as error:
            print(error)
        return response
    
    try:
        direc = pathlib.Path().absolute()
        return send_file(f"{direc}/{userID}/output/gene-sets.csv",as_attachment=True)
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)  


def _get_user_id(data_adaptor):
    annotations = data_adaptor.dataset_config.user_annotations        
    userID = f"{annotations._get_userdata_idhash(data_adaptor)}"       
    return userID

def delete_obsm_put(request, data_adaptor):
    args = request.get_json()
    embNames = args.get("embNames",None)
    fail=False
    userID = _get_user_id(data_adaptor)
    ID = userID.split('/')[0].split('\\')[0]
    paired_embeddings = pickle_loader(f"{ID}/paired_embeddings.p")

    if embNames is not None:
        for embName in embNames:
            if embName in paired_embeddings:
                k1 = paired_embeddings[embName]
                k2 = embName
                del paired_embeddings[k1]
                try:
                    del paired_embeddings[k2]
                except:
                    pass
                pickle_dumper(paired_embeddings,f"{ID}/paired_embeddings.p")                

        for embName in embNames:
            if os.path.exists(f"{userID}/emb/{embName}.p"):
                os.remove(f"{userID}/emb/{embName}.p")
            if os.path.exists(f"{userID}/nnm/{embName}.p"):
                os.remove(f"{userID}/nnm/{embName}.p")
            if os.path.exists(f"{userID}/params/{embName}.p"):
                os.remove(f"{userID}/params/{embName}.p")                

            fns = glob(f"{userID}/pca/*.p")
            for f in fns:
                if ";;"+embName in f:
                    os.remove(f)

            fns = glob(f"{userID}/var/*.p")
            for f in fns:
                if ";;"+embName in f:
                    os.remove(f)
    try:
        return make_response(jsonify({"fail": fail}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)    

def delete_obs_put(request, data_adaptor):
    args = request.get_json()
    name = args.get("name",None)
    fail=False
    userID = _get_user_id(data_adaptor)
    mode = userID.split('/')[-1].split('\\')[-1]
    otherMode = "OBS" if mode == "VAR" else "VAR"
    ID = userID.split('/')[0].split('\\')[0]+'/'+ otherMode

    if os.path.exists(f"{userID}/obs/{name}.p"):
        os.remove(f"{userID}/obs/{name}.p")
    
    if data_adaptor._joint_mode:
        if os.path.exists(f"{ID}/var/{name}.p"):
            os.remove(f"{ID}/var/{name}.p")
        if os.path.exists(f"{ID}/set/{name}/"):
            shutil.rmtree(f"{ID}/set/{name}/")                
    
    try:
        return make_response(jsonify({"fail": fail}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)    

def rename_obs_put(request, data_adaptor):
    args = request.get_json()
    oldName = args.get("oldName",None)
    newName = args.get("newName",None)
    userID = _get_user_id(data_adaptor)
    mode = userID.split('/')[-1].split('\\')[-1]
    otherMode = "OBS" if mode == "VAR" else "VAR"
    ID = userID.split('/')[0].split('\\')[0]+'/'+ otherMode
    
    if os.path.exists(f"{userID}/obs/{oldName}.p"):
        os.rename(f"{userID}/obs/{oldName}.p",f"{userID}/obs/{newName}.p")
        
        if data_adaptor._joint_mode:
            try:
                os.rename(f"{ID}/var/{oldName}.p",f"{ID}/var/{newName}.p")
            except:
                pass
            try:
                shutil.rmtree(f"{ID}/set/{oldName}/")
            except:
                pass    
    try:
        return make_response(jsonify({"schema": schema_get_helper(data_adaptor)}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 


def switch_cxg_mode(request,data_adaptor):
    userID = _get_user_id(data_adaptor)
    mode = userID.split("/")[-1].split("\\")[-1]
    ID = userID.split("/")[0].split("\\")[0]
    newMode = "OBS" if mode == "VAR" else "VAR"    
    pickle.dump(newMode, open(f"{ID}/mode.p",'wb'))

    try:
        return make_response(jsonify({"success": True}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 

def _df_to_dict(a,b):
    idx = np.argsort(a)
    a = a[idx]
    b = b[idx]
    bounds = np.where(a[:-1] != a[1:])[0] + 1
    bounds = np.append(np.append(0, bounds), a.size)
    bounds_left = bounds[:-1]
    bounds_right = bounds[1:]
    slists = [b[bounds_left[i] : bounds_right[i]] for i in range(bounds_left.size)]
    d = dict(zip(np.unique(a), [list(x) for x in slists]))
    return d

def rename_set_put(request, data_adaptor):
    args = request.get_json()
    oldName = args.get("oldName",None)
    newName = args.get("newName",None)
    if '//;;//' in oldName and '//;;//' not in newName:
        newName+='//;;//'
    oldName = oldName.replace('//;;//','__DEG__')
    newName = newName.replace('//;;//','__DEG__')

    userID = _get_user_id(data_adaptor)
    
    if os.path.exists(f"{userID}/set/{oldName.replace('/','_')}"):
        os.rename(f"{userID}/set/{oldName.replace('/','_')}",f"{userID}/set/{newName.replace('/','_')}")
    
    try:
        return make_response(jsonify({"fail": False}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 

def delete_set_put(request, data_adaptor):
    args = request.get_json()
    name = args.get("name",None)
    name = name.replace('//;;//','__DEG__')
    userID = _get_user_id(data_adaptor)

    if os.path.exists(f"{userID}/set/{name.replace('/','_')}"):
        shutil.rmtree(f"{userID}/set/{name.replace('/','_')}")
        
    try:
        return make_response(jsonify({"fail": False}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 

def rename_geneset_put(request, data_adaptor):
    args = request.get_json()
    set = args.get("set",None)
    set = "__blank__" if set == "" else set
    newSet = args.get("newSet",None)
    oldName = args.get("oldName",None)
    newName = args.get("newName",None)
    userID = _get_user_id(data_adaptor)
    src = f"{userID}/set/{set.replace('/','_')}/{oldName.replace('/','_')}.p"
    tgtFolder = f"{userID}/set/{newSet.replace('/','_')}/"
    if not os.path.exists(tgtFolder):
        os.makedirs(tgtFolder)
    tgt = f"{tgtFolder}/{newName.replace('/','_')}.p"
    if os.path.exists(src):
        os.rename(src,tgt)

    try:
        return make_response(jsonify({"fail": False}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 

def delete_geneset_put(request, data_adaptor):
    args = request.get_json()
    set = args.get("set",None)
    set = "__blank__" if set == "" else set
    name = args.get("name",None)
    userID = _get_user_id(data_adaptor)
    src = f"{userID}/set/{set.replace('/','_')}/{name.replace('/','_')}.p"    

    if os.path.exists(src):
        os.remove(src)

    try:
        return make_response(jsonify({"fail": False}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 

def rename_diff_put(request, data_adaptor):
    args = request.get_json()
    oldName = args.get("oldName",None)
    newName = args.get("newName",None)
    userID = _get_user_id(data_adaptor)
    
    if os.path.exists(f"{userID}/diff/{oldName.replace('/','_')}"):
        os.rename(f"{userID}/diff/{oldName.replace('/','_')}",f"{userID}/diff/{newName.replace('/','_')}")
    
    try:
        return make_response(jsonify({"fail": False}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 

def delete_diff_put(request, data_adaptor):
    args = request.get_json()
    name = args.get("name",None)
    userID = _get_user_id(data_adaptor)
    
    try:
        if os.path.exists(f"{userID}/diff/{name.replace('/','_')}"):
            fs = glob(f"{userID}/diff/{name.replace('/','_')}/*")
            for f in fs:
                os.remove(f)
            os.rmdir(f"{userID}/diff/{name.replace('/','_')}")
    except: 
        pass
    
    try:
        return make_response(jsonify({"fail": False}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 

def diff_group_get(request,data_adaptor):
    name = request.args.get("name",None)
    pop = request.args.get("pop",None)
    userID = _get_user_id(data_adaptor)
    try:
        x = pickle_loader(f"{userID}/diff/{name.replace('/','_')}/{pop.replace('/','_')}.p")
        return make_response(jsonify({"pop": x}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 

def diff_stats_get(request,data_adaptor):
    name = request.args.get("name",None)
    pop = request.args.get("pop",None)
    userID = _get_user_id(data_adaptor)
    try:
        x = pickle_loader(f"{userID}/diff/{name.replace('/','_')}/{pop.replace('/','_')}_output.p")
        return make_response(jsonify({"pop": x}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 

def diff_genes_get(request,data_adaptor):
    name = request.args.get("name",None)
    pop = request.args.get("pop",None)
    userID = _get_user_id(data_adaptor)
    try:
        x = pickle_loader(f"{userID}/diff/{name.replace('/','_')}/{pop.replace('/','_')}_sg.p")
        return make_response(jsonify({"pop": x}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 

def diff_genes_put(request,data_adaptor):
    args = request.get_json()
    name = args['name']
    pop = args['pop']
    sg = args['selectedGenes']
    userID = _get_user_id(data_adaptor)
    try:
        pickle_dumper(sg,f"{userID}/diff/{name.replace('/','_')}/{pop.replace('/','_')}_sg.p")
        return make_response(jsonify({"ok": True}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 


def initialize_user(data_adaptor):            
    userID = _get_user_id(data_adaptor).split("/")[0].split("\\")[0]
    if not os.path.exists(f"{userID}/"):
        os.system(f"mkdir {userID}")
        os.system(f"cp -r {data_adaptor.guest_idhash}/* {userID}/")
    #data_adaptor._initialize_user_folders(userID)           

    if not current_app.hosted_mode:
        session.clear()        

    try:
        return make_response(jsonify({"fail": False}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)    


def rename_wrapper(item,oldName,newName):
    if f";;{oldName};;" in item:
        newItem = item.replace(f";;{oldName};;",f";;{newName};;")
    elif f"{oldName};;" in item:
        newItem = item.replace(f"{oldName};;",f"{newName};;")
    elif f";;{oldName}" in item:
        newItem = item.replace(f";;{oldName}",f";;{newName}")
    elif oldName == item:
        newItem = newName
    return newItem

def rename_obsm_put(request, data_adaptor):
    args = request.get_json()
    embNames = args.get("embNames",None)
    oldName = args.get("oldName",None)
    newName = args.get("newName",None)
    userID = _get_user_id(data_adaptor)
    ID = userID.split('/')[0].split('\\')[0]
    paired_embeddings = pickle_loader(f"{ID}/paired_embeddings.p")

    if embNames is not None and oldName is not None and newName is not None:
        for embName in embNames:
            newItem = rename_wrapper(embName,oldName,newName)                        
            if embName in paired_embeddings:
                k1 = paired_embeddings[embName]
                k2 = embName
                del paired_embeddings[k1]; 
                try:
                    del paired_embeddings[k2]
                except:
                    pass
                paired_embeddings[newItem] = k1
                paired_embeddings[k1] = newItem
                pickle_dumper(paired_embeddings,f"{ID}/paired_embeddings.p")                                          
        
            newItem = rename_wrapper(embName,oldName,newName)                        
            if os.path.exists(f"{userID}/emb/{embName}.p"):
                os.rename(f"{userID}/emb/{embName}.p",f"{userID}/emb/{newItem}.p")
            if os.path.exists(f"{userID}/nnm/{embName}.p"):
                os.rename(f"{userID}/nnm/{embName}.p",f"{userID}/nnm/{newItem}.p")
            if os.path.exists(f"{userID}/params/{embName}.p"):
                os.rename(f"{userID}/params/{embName}.p",f"{userID}/params/{newItem}.p")

            fns = glob(f"{userID}/pca/*.p")
            for f in fns:
                if ";;"+embName in f:
                    os.rename(f,f.replace(embName,newItem))
            
            fns = glob(f"{userID}/var/*.p")
            for f in fns:
                if ";;"+embName in f:
                    os.rename(f,f.replace(embName,newItem))              
    try:
        layout_schema = {"name": newName, "type": "float32", "dims": [f"{newName}_0", f"{newName}_1"]}
        return make_response(jsonify({"schema": layout_schema}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 

def leiden_put(request, data_adaptor):
    args = request.get_json()
    name = args.get("name", None)
    cName = args.get("cName", None)
    resolution = args.get('resolution',1.0)
    filter = args.get('filter',None)
    try:
        userID = _get_user_id(data_adaptor)
        cl = list(data_adaptor.compute_leiden(name,cName,resolution,filter,userID))
        return make_response(jsonify({"clusters": cl}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)


def layout_obs_put(request, data_adaptor):
    args = request.get_json()
    filter = args["filter"] if args else None
    if not filter:
        return abort_and_log(HTTPStatus.BAD_REQUEST, "obs filter is required")
    method = args["method"] if args else "umap"
    reembedParams = args["params"] if args else {}
    parentName = args["parentName"] if args else ""
    embName = args["embName"] if args else None

    try:
        userID = _get_user_id(data_adaptor)                 
        schema = data_adaptor.compute_embedding(method, filter, reembedParams, parentName, embName, userID, hosted = current_app.hosted_mode)
        return make_response(jsonify({"layoutSchema": schema, "schema": schema_get_helper(data_adaptor)}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)


def preprocess_put(request, data_adaptor):
    args = request.get_json()
    reembedParams = args["params"] if args else {}
    filter = args["filter"] if args else None
    if not filter:
        return abort_and_log(HTTPStatus.BAD_REQUEST, "obs filter is required")
        
    try:
        userID = _get_user_id(data_adaptor)            
        data_adaptor.compute_preprocess(reembedParams, filter, userID)
        return make_response(jsonify(schema_get_helper(data_adaptor)), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)


def reembed_parameters_get(request, data_adaptor):
    preferred_mimetype = request.accept_mimetypes.best_match(["application/json", "text/csv"])
    if preferred_mimetype not in ("application/json", "text/csv"):
        return abort(HTTPStatus.NOT_ACCEPTABLE)

    try:
        annotations = data_adaptor.dataset_config.user_annotations
        (reembedParams) = annotations.read_reembed_parameters(data_adaptor)
        return make_response(
            jsonify({"reembedParams": reembedParams}), HTTPStatus.OK
        )
    except (ValueError, KeyError, AnnotationsError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e))

def reembed_parameters_obsm_put(request, data_adaptor):
    embName = request.get_json()["embName"]
    userID = _get_user_id(data_adaptor)
    try:
        reembedParams = pickle_loader(f"{userID}/params/{embName}")
    except:
        reembedParams = None

    if reembedParams is not None:
        reembedParams = reembedParams.copy()
        try:
            del reembedParams['parentParams']
        except:
            pass
        try:
            del reembedParams['sample_ids']
        except:
            pass
        try:
            del reembedParams['feature_ids']
        except:
            pass
        try:
            del reembedParams['feature_weights']
        except:
            pass

    try:
        if reembedParams is not None:
            for k in reembedParams.keys():
                if type(reembedParams[k]).__module__ == 'numpy':
                    reembedParams[k] = reembedParams[k].item()
            return make_response(
                jsonify({"reembedParams": reembedParams}), HTTPStatus.OK
            )
        else:
            return make_response(
                jsonify({"reembedParams": {}}), HTTPStatus.OK
            )            
    except (ValueError, KeyError, AnnotationsError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e))

def reembed_parameters_put(request, data_adaptor):
    annotations = data_adaptor.dataset_config.user_annotations

    anno_collection = request.args.get("annotation-collection-name", default=None)
    if anno_collection is not None:
        if not annotations.is_safe_collection_name(anno_collection):
            return abort(HTTPStatus.BAD_REQUEST, "Bad annotation collection name")
        annotations.set_collection(anno_collection)

    args = request.get_json()
    try:
        reembedParams = args.get("reembedParams", None)
        if reembedParams is None:
            abort(HTTPStatus.BAD_REQUEST)

        annotations.write_reembed_parameters(reembedParams, data_adaptor)
        return make_response(jsonify({"status": "OK"}), HTTPStatus.OK)
    except (ValueError, DisabledFeatureError, KeyError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)
    except (ObsoleteRequest, TypeError) as e:
        return abort(HTTPStatus.NOT_FOUND, description=str(e))

def genesets_get(request, data_adaptor):
    userID = _get_user_id(data_adaptor)
    genesets = {}
    for k in glob(f"{userID}/set/*"):
        k = k.split('/')[-1].split('\\')[-1]
        set = "" if k == "__blank__" else k
        set = set.replace('__DEG__','//;;//') if set.endswith('__DEG__') else set
        genesets[set] = {}
        for k2 in glob(f"{userID}/set/{k}/*.p"):
            kn2 = k2.split('/')[-1].split('\\')[-1].split('.p')[0]
            genesets[set][kn2] = pickle_loader(k2)

    return make_response(
        jsonify({"genesets": genesets}), HTTPStatus.OK
    )

def genesets_put(request, data_adaptor):
    userID = _get_user_id(data_adaptor)
    genesets = request.get_json()
    for set in genesets:
        setn = "__blank__" if set == "" else set
        setn = setn.replace('//;;//','__DEG__')
        if not os.path.exists(f"{userID}/set/{setn}/"):
            os.makedirs(f"{userID}/set/{setn}/")        
        for name in genesets[set]:
            pickle_dumper(genesets[set][name],f"{userID}/set/{setn}/{name}.p")

        if '//;;//' not in set and data_adaptor._joint_mode:
            # convert genesets to obs
            v = pickle_loader(f"{userID}/var/name_0.p")
            ID = userID.split('/')[0].split('\\')[0]
            mode = userID.split('/')[-1].split('\\')[-1]
            otherMode = "OBS" if mode == "VAR" else "VAR"
            genesets = {}
            for k2 in glob(f"{userID}/set/{setn}/*.p"):
                kn2 = k2.split('/')[-1].split('\\')[-1].split('.p')[0]
                genesets[kn2] = pickle_loader(k2)

            if set != "":
                C = []
                O = []
                for key2 in genesets:
                    o = genesets[key2]
                    O.extend(o)
                    C.extend([key2]*len(o))
                C = np.array(C)
                O = np.array(O)
                d = _df_to_dict(O,C)

                for kk in d.keys():
                    if len(d[kk])>1:
                        d[kk] = d[kk][np.argmin(np.array([np.where(np.array(genesets[mm])==kk)[0][0] for  mm in d[kk]]))]
                    else:
                        d[kk] = d[kk][0]
                C = np.array(list(d.values()))
                O = np.array(list(d.keys()))
                
                f = np.in1d(v,O,invert=True)
                vnot = v[f] 
                C = np.append(C,["unassigned"]*len(vnot)) 
                O = np.append(O,vnot) 
                vals = pd.Series(data=C,index=O)[v].values.flatten()

                pickle_dumper(vals,f"{ID}/{otherMode}/obs/{set}.p")

    return make_response(jsonify({"status": "OK"}), HTTPStatus.OK)
   
def genesets_rename_put(request, data_adaptor):
    annotations = data_adaptor.dataset_config.user_annotations
    if not annotations.gene_sets_save_enabled():
        return abort(HTTPStatus.NOT_IMPLEMENTED)

    anno_collection = request.args.get("annotation-collection-name", default=None)
    if anno_collection is not None:
        if not annotations.is_safe_collection_name(anno_collection):
            return abort(HTTPStatus.BAD_REQUEST, "Bad annotation collection name")
        annotations.set_collection(anno_collection)

    args = request.get_json()
    
    oldName = args.get("oldName", None)
    newName = args.get("newName", None)
    if oldName is None or newName is None:
        abort(HTTPStatus.BAD_REQUEST)

    genesets, _ = annotations.read_gene_sets(data_adaptor)
    genesets[newName] = genesets[oldName]
    del genesets[oldName]
    annotations.write_gene_sets(genesets, annotations.last_geneset_tid+1, data_adaptor)
    return make_response(jsonify({"status": "OK"}), HTTPStatus.OK)



def summarize_var_helper(request, data_adaptor, key, raw_query):
    preferred_mimetype = request.accept_mimetypes.best_match(["application/octet-stream"])
    if preferred_mimetype != "application/octet-stream":
        return abort(HTTPStatus.NOT_ACCEPTABLE)

    summary_method = request.values.get("method", default="mean")
    query_hash = summarizeQueryHash(raw_query)
    if key and query_hash != key:
        return abort(HTTPStatus.BAD_REQUEST, description="query key did not match")

    args_filter_only = request.values.copy()
    args_filter_only.poplist("method")
    args_filter_only.poplist("key")
    args_filter_only.poplist("layer")
    args_filter_only.poplist("logscale")
    args_filter_only.poplist("scale")

    try:
        layer = request.values.get("layer", default="X")  
        logscale = request.values.get("logscale", default="false")=="true"        
        scale = request.values.get("scale", default="false")=="true"  
        filter = _query_parameter_to_filter(args_filter_only)
        return make_response(
            data_adaptor.summarize_var(summary_method, filter, query_hash, layer, logscale, scale),
            HTTPStatus.OK,
            {"Content-Type": "application/octet-stream"},
        )
    except (ValueError) as e:
        return abort(HTTPStatus.NOT_FOUND, description=str(e))

def summarize_var_get(request, data_adaptor):
    return summarize_var_helper(request, data_adaptor, None, request.query_string)


def summarize_var_post(request, data_adaptor):
    if not request.content_type or "application/x-www-form-urlencoded" not in request.content_type:
        return abort(HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
    if request.content_length > 1_000_000:  # just a sanity check to avoid memory exhaustion
        return abort(HTTPStatus.BAD_REQUEST)

    key = request.args.get("key", default=None)
    return summarize_var_helper(request, data_adaptor, key, request.get_data())
