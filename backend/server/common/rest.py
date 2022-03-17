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
from anndata import AnnData
import pickle
from backend.common.utils.type_conversion_utils import get_schema_type_hint_of_array
from backend.server.common.config.client_config import get_client_config, get_client_userinfo
from backend.common.constants import Axis, DiffExpMode, JSON_NaN_to_num_warning_msg
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

    schema = {
        "dataframe": {"nObs": data_adaptor.cell_count, "nVar": data_adaptor.gene_count, "type": str(data_adaptor.data.X.dtype)},
        "annotations": {
            "obs": {"index": data_adaptor.parameters.get("obs_names"), "columns": []},
            "var": {"index": data_adaptor.parameters.get("var_names"), "columns": []},
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
                    ann_schema = {"name": ann, "writable": True}
                    ann_schema.update(get_schema_type_hint_of_array(x))
                    schema["annotations"]["var"]["columns"].append(ann_schema)
            
            ann = "name_0"
            curr_axis = data_adaptor.data.var
            ann_schema = {"name": ann, "writable": True}
            ann_schema.update(get_schema_type_hint_of_array(curr_axis[ann]))
            if ann_schema['type']!='categorical':
                ann_schema['writable']=False
            schema["annotations"][ax]["columns"].append(ann_schema)
            
        elif str(ax) == "obs":
            fns = glob(f"{userID}/obs/*.p")
            for ann in fns:
                ann=ann.split('.p')[0].split('/')[-1].split('\\')[-1]
                if ann != "name_0":
                    x = pickle_loader(f"{userID}/obs/{ann}.p")
                    ann_schema = {"name": ann, "writable": True}
                    ann_schema.update(get_schema_type_hint_of_array(x))
                    schema["annotations"][ax]["columns"].append(ann_schema)
            
            ann = "name_0"
            curr_axis = data_adaptor.data.obs
            ann_schema = {"name": ann, "writable": True}
            ann_schema.update(get_schema_type_hint_of_array(curr_axis[ann]))
            if ann_schema['type']!='categorical':
                ann_schema['writable']=False
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
    direc = pathlib.Path().absolute()    

    if varM is not None and gene is not None:
        try:
            X = pickle_loader(f"{direc}/{userID}/var/{varM};;{name}.p")
        except:
            X = pickle_loader(f"{direc}/{userID}/var/{varM}.p")
        n = pickle_loader(f"{direc}/{userID}/var/name_0.p")                    
        return make_response(jsonify({"response": X[n==gene]}), HTTPStatus.OK)
    else:
        return make_response(jsonify({"response": "NaN"}), HTTPStatus.OK)

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
    direc = pathlib.Path().absolute()  

    if varM != "":
        try:
            X = pickle_loader(f"{direc}/{userID}/var/{varM};;{name}.p")
        except:
            X = pickle_loader(f"{direc}/{userID}/var/{varM}.p")
        n = pickle_loader(f"{direc}/{userID}/var/name_0.p")   

        return make_response(jsonify({"response": list(pd.Series(data=X,index=n)[geneSet].values)}), HTTPStatus.OK)
    else:
        return make_response(jsonify({"response": "ok"}), HTTPStatus.OK)        

def config_get(app_config, data_adaptor):
    config = get_client_config(app_config, data_adaptor)
    return make_response(jsonify(config), HTTPStatus.OK)


def userinfo_get(app_config, data_adaptor):
    config = get_client_userinfo(app_config, data_adaptor)
    return make_response(jsonify(config), HTTPStatus.OK)


def annotations_obs_get(request, data_adaptor):
    fields = request.args.getlist("annotation-name", None)
    num_columns_requested = len(data_adaptor.get_obs_keys()) if len(fields) == 0 else len(fields)
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
            labels=pd.DataFrame()
            for f in fields:
                labels[f] = pickle_loader(f"{userID}/obs/{f}.p")
            labels.index = pd.Index(np.array(list(data_adaptor.data.obs['name_0']),dtype='object'))
        fbs = data_adaptor.annotation_to_fbs_matrix(Axis.OBS, fields, labels)
        return make_response(fbs, HTTPStatus.OK, {"Content-Type": "application/octet-stream"})
    except KeyError as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)

def annotations_var_get(request, data_adaptor):
    fields = request.args.getlist("annotation-name", None)
    name = request.args.get("embName", None)
    num_columns_requested = len(data_adaptor.get_var_keys()) if len(fields) == 0 else len(fields)
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
            labels=pd.DataFrame()
            for f in fields:
                try:
                    labels[f] = pickle_loader(f"{userID}/var/{f};;{name}.p")
                except:
                    labels[f] = pickle_loader(f"{userID}/var/{f}.p")
            labels.index = pd.Index(np.array(list(data_adaptor.data.var['name_0']),dtype='object'))
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
        userID = _get_user_id(data_adaptor)
        for col in new_label_df:
            pickle_dumper(np.array(list(new_label_df[col]),dtype='object'),"{}/obs/{}.p".format(userID,col.replace('/',':')))

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
            pickle_dumper(np.array(list(new_label_df[col]),dtype='object'),"{}/var/{};;{}.p".format(userID,col.replace('/',':'),name))

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
    try:
        return make_response(
            data_adaptor.data_frame_to_fbs_matrix(filter, axis=Axis.VAR,layer=layer,logscale=logscale),
            HTTPStatus.OK,
            {"Content-Type": "application/octet-stream"},
        )
    except (FilterError, ValueError, ExceedsLimitError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)


def data_var_get(request, data_adaptor):
    preferred_mimetype = request.accept_mimetypes.best_match(["application/octet-stream"])
    if preferred_mimetype != "application/octet-stream":
        return abort(HTTPStatus.NOT_ACCEPTABLE)

    try:
        layer = request.values.get("layer", default="X")
        logscale = request.values.get("logscale", default="false") == "true"
        args_filter_only = request.args.copy()
        args_filter_only.poplist("layer")  
        args_filter_only.poplist("logscale")        
        filter = _query_parameter_to_filter(args_filter_only)
        return make_response(
            data_adaptor.data_frame_to_fbs_matrix(filter, axis=Axis.VAR, layer=layer, logscale=logscale),
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
    direc = pathlib.Path().absolute()
    userID = _get_user_id(data_adaptor)         
    filename = file.filename.split('/')[-1].split('\\')[-1]
    file.save(f"{direc}/{userID}/{filename}")
    A = pd.read_csv(f"{direc}/{userID}/{filename}",sep='\t',index_col=0)
    v1 = np.array(list(A.index))    
    v2 = np.array(list(pickle_loader(f"{direc}/{userID}/var/name_0.p")))
    filt = np.in1d(v1,v2)
    v1 = v1[filt]    
    assert v1.size > 0

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
        pickle_dumper(vals,"{}/{}/var/{}.p".format(direc,userID,k.replace('/',':')))

    @after_this_request
    def remove_file(response):
        try:
            os.remove(f"{direc}/{userID}/{filename}")
        except Exception as error:
            print(error)
        return response    
    schema = schema_get_helper(data_adaptor)
    return make_response(jsonify({"schema": schema}), HTTPStatus.OK)

def save_var_metadata_put(request, data_adaptor):
    args = request.get_json()
    embName = args['embName']

    direc = pathlib.Path().absolute()
    userID = _get_user_id(data_adaptor)        

    fnames = glob(f"{direc}/{userID}/var/*.p")
    v = pickle_loader(f"{direc}/{userID}/var/name_0.p")
    var=pd.DataFrame(data=v[:,None],index=v,columns=["name_0"])
    for f in fnames:
        n = f.split('/')[-1].split('\\')[-1][:-2]
        if ';;' in n:
            tlay = n.split(';;')[-1]
        else:
            tlay = ""
        if embName == tlay:
            l = pickle_loader(f"{direc}/{userID}/var/{n}.p")
            if n != "name_0":
                var[n.split(';;')[0]] = pd.Series(data=l,index=v)  

    vkeys = list(var.keys())
    for f in fnames:
        n = f.split('/')[-1].split('\\')[-1][:-2]
        if ';;' not in n:
            if n not in vkeys:
                l = pickle_loader(f"{direc}/{userID}/var/{n}.p")
                if n != "name_0":
                    var[n] = pd.Series(data=l,index=v)                   
    del var['name_0']    
    var.to_csv(f"{userID}/{userID}_var.txt",sep='\t')

    @after_this_request
    def remove_file(response):
        try:
            os.remove(f"{userID}/{userID}_var.txt")
        except Exception as error:
            print(error)
        return response

    try:
        direc = pathlib.Path().absolute()
        return send_file(f"{direc}/{userID}/{userID}_var.txt",as_attachment=True)

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
    
    labels.index = pd.Index(np.array(list(data_adaptor.data.obs['name_0']),dtype='object'))
    labels = labels[obs_mask]
    labels.to_csv(f"{userID}/{userID}_obs.txt",sep='\t')

    @after_this_request
    def remove_file(response):
        try:
            os.remove(f"{userID}/{userID}_obs.txt")
        except Exception as error:
            print(error)
        return response

    try:
        direc = pathlib.Path().absolute()
        return send_file(f"{direc}/{userID}/{userID}_obs.txt",as_attachment=True)
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True)  

def save_genedata_put(request, data_adaptor):
    userID = _get_user_id(data_adaptor)        
    try:
        direc = pathlib.Path().absolute()
        return send_file(f"{direc}/{userID}/gene-sets.csv",as_attachment=True)
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
    if embNames is not None:
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

    if os.path.exists(f"{userID}/obs/{name}.p"):
        os.remove(f"{userID}/obs/{name}.p")
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
    
    if os.path.exists(f"{userID}/obs/{oldName}.p"):
        os.rename(f"{userID}/obs/{oldName}.p",f"{userID}/obs/{newName}.p")
    
    try:
        return make_response(jsonify({"schema": schema_get_helper(data_adaptor)}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 

def rename_diff_put(request, data_adaptor):
    args = request.get_json()
    oldName = args.get("oldName",None)
    newName = args.get("newName",None)
    userID = _get_user_id(data_adaptor)
    
    if os.path.exists(f"{userID}/diff/{oldName.replace('/',':')}"):
        os.rename(f"{userID}/diff/{oldName.replace('/',':')}",f"{userID}/diff/{newName.replace('/',':')}")
    
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
        if os.path.exists(f"{userID}/diff/{name.replace('/',':')}"):
            fs = glob(f"{userID}/diff/{name.replace('/',':')}/*")
            for f in fs:
                os.remove(f)
            os.rmdir(f"{userID}/diff/{name.replace('/',':')}")
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
        x = pickle_loader(f"{userID}/diff/{name.replace('/',':')}/{pop.replace('/',':')}.p")
        return make_response(jsonify({"pop": x}), HTTPStatus.OK, {"Content-Type": "application/json"})
    except NotImplementedError as e:
        return abort_and_log(HTTPStatus.NOT_IMPLEMENTED, str(e))
    except (ValueError, DisabledFeatureError, FilterError) as e:
        return abort_and_log(HTTPStatus.BAD_REQUEST, str(e), include_exc_info=True) 



def initialize_user(data_adaptor):            
    userID = _get_user_id(data_adaptor)
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

    
    if embNames is not None and oldName is not None and newName is not None:
        for embName in embNames:
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

def genesets_get(request, data_adaptor):
    preferred_mimetype = request.accept_mimetypes.best_match(["application/json", "text/csv"])
    if preferred_mimetype not in ("application/json", "text/csv"):
        return abort(HTTPStatus.NOT_ACCEPTABLE)

    annotations = data_adaptor.dataset_config.user_annotations
    (genesets, tid) = annotations.read_gene_sets(data_adaptor)
    
    for k in list(genesets.keys()):
        if len(genesets[k])==0:
            del genesets[k]
    
    if preferred_mimetype == "text/csv":
        return make_response(
            annotations.gene_sets_to_csv(genesets),
            HTTPStatus.OK,
            {
                "Content-Type": "text/csv",
                "Content-Disposition": "attachment; filename=genesets.csv",
            },
        )
    else:
        return make_response(
            jsonify({"genesets": genesets, "tid": tid}), HTTPStatus.OK
        )


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


def genesets_put(request, data_adaptor):
    annotations = data_adaptor.dataset_config.user_annotations
    if not annotations.gene_sets_save_enabled():
        return abort(HTTPStatus.NOT_IMPLEMENTED)

    anno_collection = request.args.get("annotation-collection-name", default=None)
    if anno_collection is not None:
        if not annotations.is_safe_collection_name(anno_collection):
            return abort(HTTPStatus.BAD_REQUEST, "Bad annotation collection name")
        annotations.set_collection(anno_collection)

    args = request.get_json()
    genesets = args.get("genesets", None)
    tid = args.get("tid", None)
    if genesets is None:
        abort(HTTPStatus.BAD_REQUEST)

    annotations.write_gene_sets(genesets, tid, data_adaptor)
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

    try:
        layer = request.values.get("layer", default="X")  
        logscale = request.values.get("logscale", default="false")=="true"        
        filter = _query_parameter_to_filter(args_filter_only)
        return make_response(
            data_adaptor.summarize_var(summary_method, filter, query_hash, layer, logscale),
            HTTPStatus.OK,
            {"Content-Type": "application/octet-stream"},
        )
    except (ValueError) as e:
        return abort(HTTPStatus.NOT_FOUND, description=str(e))
    except (UnsupportedSummaryMethod, FilterError) as e:
        return abort(HTTPStatus.BAD_REQUEST, description=str(e))


def summarize_var_get(request, data_adaptor):
    return summarize_var_helper(request, data_adaptor, None, request.query_string)


def summarize_var_post(request, data_adaptor):
    if not request.content_type or "application/x-www-form-urlencoded" not in request.content_type:
        return abort(HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
    if request.content_length > 1_000_000:  # just a sanity check to avoid memory exhaustion
        return abort(HTTPStatus.BAD_REQUEST)

    key = request.args.get("key", default=None)
    return summarize_var_helper(request, data_adaptor, key, request.get_data())
