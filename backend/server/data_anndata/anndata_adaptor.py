import warnings
from datetime import datetime
import anndata
import numpy as np
from packaging import version
import pandas as pd
import scipy as sp
import traceback
from pandas.core.dtypes.dtypes import CategoricalDtype
from scipy import sparse
from server_timing import Timing as ServerTiming
import time
import os
import gc
from glob import glob
import scanpy as sc
import scanpy.external as sce
import scipy as sp
from samalg import SAM
import backend.common.compute.diffexp_generic as diffexp_generic
from flask import jsonify, request, current_app, session, after_this_request, send_file
from backend.common.colors import convert_anndata_category_colors_to_cxg_category_colors
from backend.common.constants import Axis, MAX_LAYOUTS
from backend.server.common.corpora import corpora_get_props_from_anndata
from backend.common.errors import PrepareError, DatasetAccessError, FilterError
from backend.common.utils.type_conversion_utils import get_schema_type_hint_of_array
from anndata import AnnData
from backend.server.data_common.data_adaptor import DataAdaptor
from backend.common.fbs.matrix import encode_matrix_fbs
from multiprocessing import Pool, RawArray
from functools import partial
import backend.server.common.rest as common_rest
import json
from backend.common.utils.utils import jsonify_numpy
import signal
import pickle
import pathlib
import base64
import sys
from hashlib import blake2b
from functools import wraps
from multiprocessing import current_process, set_start_method, resource_tracker
from os.path import exists
import sklearn.utils.sparsefuncs as sf
from numba import njit, prange, config, threading_layer
from numba.core import types
from numba.typed import Dict


if current_process().name == 'MainProcess':
    print("Configuring multiprocessing spawner...")
    if sys.platform.startswith('linux'):
        set_start_method("spawn")

global process_count
process_count = 0

anndata_version = version.parse(str(anndata.__version__)).release

def desktop_mode_only(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if current_app.hosted_mode:
            return jsonify({'message' : 'Feature only available in desktop mode.'}), 401
  
        return  f(*args, **kwargs)
  
    return decorated    

def auth0_token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = 'excxg_profile' in session
        # return 401 if token is not passed
        if not token and current_app.hosted_mode:
            return jsonify({'message' : 'Authorization missing.'}), 401
  
        return  f(*args, **kwargs)
  
    return decorated

def anndata_version_is_pre_070():
    major = anndata_version[0]
    minor = anndata_version[1] if len(anndata_version) > 1 else 0
    return major == 0 and minor < 7

def _callback_fn(res,ws,cfn,data,post_processing,tstart):
    if post_processing is not None:
        res = post_processing(res)
    d = {"response": res,"cfn": cfn, "fail": False}
    d.update(data)
    ws.send(jsonify_numpy(d))
    global process_count
    process_count = process_count + 1
    print("Process count:",process_count,"Time elsapsed:",time.time()-tstart,"seconds")


def _multiprocessing_wrapper(da,ws,fn,cfn,data,post_processing,*args):
    _new_callback_fn = partial(_callback_fn,ws=ws,cfn=cfn,data=data,post_processing=post_processing,tstart=time.time())
    _new_error_fn = partial(_error_callback,ws=ws, cfn=cfn)
    da.pool.apply_async(fn,args=args, callback=_new_callback_fn, error_callback=_new_error_fn)
    #if current_app.hosted_mode:
    #else:
    #    try:
    #        res = fn(*args)
    #        _new_callback_fn(res)
    #    except Exception as e:
    #        _error_callback(e,ws,cfn)

def _error_callback(e, ws, cfn):
    ws.send(jsonify_numpy({"fail": True, "cfn": cfn}))
    traceback.print_exception(type(e), e, e.__traceback__)

    
def compute_diffexp_ttest(layer,tMean,tMeanSq,obs_mask_A,obs_mask_B,top_n,lfc_cutoff,ihm):
    iA = np.where(obs_mask_A)[0]
    iB = np.where(obs_mask_B)[0]
    niA = np.where(np.invert(np.in1d(np.arange(obs_mask_A.size),iA)))[0]
    niB = np.where(np.invert(np.in1d(np.arange(obs_mask_A.size),iB)))[0]
    nA = iA.size
    nB = iB.size

    CUTOFF = 35000
    
    if nA + nB == obs_mask_A.size:
        if nA < nB:
            if (nA < CUTOFF):
                XI = _create_data_from_shm(*shm[layer])
                n = XI.shape[0]
                meanA,vA = sf.mean_variance_axis(XI[iA],axis=0)
                meanAsq = vA-meanA**2
                meanAsq[meanAsq<0]=0
            else:
                XI = _create_data_from_shm_csc(*shm_csc[layer])
                n = XI.shape[0]

                meanA,meanAsq = _partial_summer(XI.data,XI.indices,XI.indptr,XI.shape[1],iA,niA)
                meanA/=nA
                meanAsq/=nA
                vA = meanAsq - meanA**2
                vA[vA<0]=0
            
            meanB = (tMean*n - meanA*nA) / nB
            meanBsq = (tMeanSq*n - meanAsq*nA) / nB
            vB = meanBsq - meanB**2                 

        else:
            if (nB < CUTOFF):
                XI = _create_data_from_shm(*shm[layer])
                n = XI.shape[0]
                meanB,vB = sf.mean_variance_axis(XI[iB],axis=0)    
                meanBsq = vB-meanB**2
                meanBsq[meanBsq<0]=0                
            else:
                XI = _create_data_from_shm_csc(*shm_csc[layer])
                n = XI.shape[0]

                meanB,meanBsq = _partial_summer(XI.data,XI.indices,XI.indptr,XI.shape[1],iB,niB)
                meanB/=nB
                meanBsq/=nB
                vB = meanBsq - meanB**2
                vB[vB<0]=0

            meanA = (tMean*n - meanB*nB) / nA
            meanAsq = (tMeanSq*n - meanBsq*nB) / nA
            vA = meanAsq - meanA**2                 
    else:
        if (nA < CUTOFF):
            XI = _create_data_from_shm(*shm[layer])
            n = XI.shape[0]
            meanA,vA = sf.mean_variance_axis(XI[iA],axis=0)    
        else:
            XI = _create_data_from_shm_csc(*shm_csc[layer])
            n = XI.shape[0]

            meanA,meanAsq = _partial_summer(XI.data,XI.indices,XI.indptr,XI.shape[1],iA,niA)
            meanA/=nA
            meanAsq/=nA
            vA = meanAsq - meanA**2
            vA[vA<0]=0

        if (nB < CUTOFF):
            XI = _create_data_from_shm(*shm[layer])
            n = XI.shape[0]
            meanB,vB = sf.mean_variance_axis(XI[iB],axis=0)    
        else:
            XI = _create_data_from_shm_csc(*shm_csc[layer])
            n = XI.shape[0]

            meanB,meanBsq = _partial_summer(XI.data,XI.indices,XI.indptr,XI.shape[1],iB,niB)
            meanB/=nB
            meanBsq/=nB
            vB = meanBsq - meanB**2
            vB[vB<0]=0            

    
    return diffexp_generic.diffexp_ttest(meanA,vA,nA,meanB,vB,nB,top_n,lfc_cutoff)

def pickle_loader(fn):
    with open(fn,"rb") as f:
        x = pickle.load(f)
    return x

def save_data(AnnDataDict,labelNames,cids,currentLayout,obs_mask,userID,ihm):
    direc = pathlib.Path().absolute()        

    fnames = glob(f"{direc}/{userID}/emb/*.p")


    name = currentLayout.split(';')[-1]
  
    embs = {}
    nnms = {}
    params={}
    pcas = {}
    for f in fnames:
        n = f.split('/')[-1].split('\\')[-1][:-2]
        if name == n.split(';')[-1] or (';;' not in currentLayout and ';;' not in n):
            if exists(f) and exists(f"{direc}/{userID}/nnm/{n}.p") and exists(f"{direc}/{userID}/params/{n}.p") and exists(f"{direc}/{userID}/pca/{n}.p"):
                embs[n] = pickle_loader(f)
                nnms[n] = pickle_loader(f"{direc}/{userID}/nnm/{n}.p")
                params[n] = pickle_loader(f"{direc}/{userID}/params/{n}.p")
                pcas[n] = pickle_loader(f"{direc}/{userID}/pca/{n}.p")
            elif exists(f) and exists(f"{direc}/{userID}/nnm/{n}.p") and exists(f"{direc}/{userID}/params/{n}.p"):
                embs[n] = pickle_loader(f)
                nnms[n] = pickle_loader(f"{direc}/{userID}/nnm/{n}.p")
                params[n] = pickle_loader(f"{direc}/{userID}/params/{n}.p")
            elif exists(f):
                embs[n] = pickle_loader(f)
    
    X = embs[currentLayout]
    f = np.isnan(X).sum(1)==0    
    filt = np.logical_and(f,obs_mask)

    X = _create_data_from_shm(*shm["X"])

    v = pickle_loader(f"{direc}/{userID}/var/name_0.p")
    adata = AnnData(X = X[filt])
    adata.var_names = pd.Index(v)
    adata.obs_names = pd.Index(cids[filt])

    for k in AnnDataDict['varm'].keys():
        adata.varm[k] = AnnDataDict['varm'][k]


    if labelNames:
        for n in labelNames:
            l = pickle_loader(f"{direc}/{userID}/obs/{n}.p")[filt]
            if n != "name_0":
                adata.obs[n] = pd.Categorical(l)        

    fnames = glob(f"{direc}/{userID}/var/*.p")
    for f in fnames:
        n = f.split('/')[-1].split('\\')[-1][:-2]
        if ';;' in n:
            tlay = n.split(';;')[-1]
        else:
            tlay = ""

        if name == tlay:
            l = pickle_loader(f"{direc}/{userID}/var/{n}.p")
            if n != "name_0":
                adata.var[n.split(';;')[0]] = pd.Series(data=l,index=v)              
    
    vkeys = list(adata.var.keys())
    for f in fnames:
        n = f.split('/')[-1].split('\\')[-1][:-2]
        if ';;' not in n:
            if n not in vkeys:
                l = pickle_loader(f"{direc}/{userID}/var/{n}.p")
                if n != "name_0":
                    adata.var[n] = pd.Series(data=l,index=v)  

    temp = {}
    for key in nnms.keys():
        temp[key] = nnms[key][filt][:,filt]
    for key in temp.keys():
        adata.obsp["N_"+key.split(';;')[-1]] = temp[key]
    for key in params.keys():
        adata.uns["N_"+key.split(';;')[-1]+"_params"]=params[key]
    for key in embs.keys():
        adata.obsm["X_"+key.split(';;')[-1]] = embs[key][filt] 
    for key in pcas.keys():
        adata.obsm["X_"+key.split(';;')[-1]+"_pca"] = pcas[key][filt]         

    keys = list(adata.var.keys())
    for k in keys:
        if ";;tMean" in k:
            del adata.var[k]
                
    for k in AnnDataDict["Xs"]:
        if k != "X":
            X = _create_data_from_shm(*shm[k])
            adata.layers[k] = X[filt]

    adata.write_h5ad(f"{direc}/output/{userID}_{currentLayout.replace(';','_')}.h5ad")
    return f"{direc}/output/{userID}_{currentLayout.replace(';','_')}.h5ad"

def compute_embedding(AnnDataDict, reembedParams, parentName, embName, currentLayout, userID, ihm):    
    obs_mask = AnnDataDict['obs_mask']    
    embeddingMode = reembedParams.get("embeddingMode","Preprocess and run")
    X_full = None
    if embeddingMode == "Preprocess and run":
        with ServerTiming.time("layout.compute"):        
            adata = compute_preprocess(AnnDataDict, reembedParams, userID, ihm)
            X_full = adata.X
            if adata.isbacked:
                raise NotImplementedError("Backed mode is incompatible with re-embedding")

            for k in list(adata.obsm.keys()):
                del adata.obsm[k]
            
            doSAM = reembedParams.get("doSAM",False)
            nTopGenesHVG = reembedParams.get("nTopGenesHVG",2000)
            nBinsHVG = reembedParams.get("nBins",20)
            doBatch = reembedParams.get("doBatch",False)
            batchMethod = reembedParams.get("batchMethod","Scanorama")
            batchKey = reembedParams.get("batchKey","")
            scanoramaKnn = reembedParams.get("scanoramaKnn",20)
            scanoramaSigma = reembedParams.get("scanoramaSigma",15)
            scanoramaAlpha = reembedParams.get("scanoramaAlpha",0.1)
            scanoramaBatchSize = reembedParams.get("scanoramaBatchSize",5000)
            bbknnNeighborsWithinBatch = reembedParams.get("bbknnNeighborsWithinBatch",3)
            numPCs = reembedParams.get("numPCs",150)
            pcaSolver = reembedParams.get("pcaSolver","randomized")
            neighborsKnn = reembedParams.get("neighborsKnn",20)
            neighborsMethod = reembedParams.get("neighborsMethod","umap")
            distanceMetric = reembedParams.get("distanceMetric","cosine")
            nnaSAM = reembedParams.get("nnaSAM",50)
            weightModeSAM = reembedParams.get("weightModeSAM","dispersion")
            umapMinDist = reembedParams.get("umapMinDist",0.1)
            scaleData = reembedParams.get("scaleData",False)
            samHVG = reembedParams.get("samHVG",False)

            if not doSAM:
                if samHVG:
                    adata = adata[:,np.sort(np.argsort(-np.array(list(adata.var['sam_weights'])))[:min(nTopGenesHVG,adata.shape[1])])]
                else:
                    try:
                        sc.pp.highly_variable_genes(adata,flavor='seurat_v3',n_top_genes=min(nTopGenesHVG,adata.shape[1]), n_bins=nBinsHVG)                
                        adata = adata[:,adata.var['highly_variable']]                
                    except:
                        print('Error during HVG selection - some of your expressions are probably negative.')
                X = adata.X
                if scaleData:
                    sc.pp.scale(adata,max_value=10)

                sc.pp.pca(adata,n_comps=min(min(adata.shape) - 1, numPCs), svd_solver=pcaSolver)
                adata.X = X
            else:            
                sam=SAM(counts = adata, inplace=True)
                X = sam.adata.X
                preprocessing = "StandardScaler" if scaleData else "Normalizer"
                bk=batchKey if batchMethod == "Harmony" else None
                sam.run(batch_key=bk,n_genes=nTopGenesHVG,projection=None,npcs=min(min(adata.shape) - 1, numPCs), weight_mode=weightModeSAM,preprocessing=preprocessing,distance=distanceMetric,num_norm_avg=nnaSAM)
                sam.adata.X = X        
                adata=sam.adata

            if doBatch:
                if doSAM:
                    adata_batch = sam.adata
                else:
                    adata_batch = adata
                
                if batchMethod == "Harmony" and not doSAM:
                    sce.pp.harmony_integrate(adata_batch,batchKey,adjusted_basis="X_pca")
                elif batchMethod == "BBKNN":
                    sce.pp.bbknn(adata_batch, batch_key=batchKey, metric=distanceMetric, n_pcs=numPCs, neighbors_within_batch=bbknnNeighborsWithinBatch)
                elif batchMethod == "Scanorama":
                    sce.pp.scanorama_integrate(adata_batch, batchKey, basis='X_pca', adjusted_basis='X_pca',
                                        knn=scanoramaKnn, sigma=scanoramaSigma, alpha=scanoramaAlpha,
                                        batch_size=scanoramaBatchSize)    

                if doSAM:
                    sam.adata = adata_batch
                else:
                    adata = adata_batch

            if not doSAM or doSAM and batchMethod == "BBKNN":
                if not doBatch or doBatch and batchMethod != "BBKNN":
                    sc.pp.neighbors(adata, n_neighbors=neighborsKnn, use_rep="X_pca",method=neighborsMethod, metric=distanceMetric)    
                sc.tl.umap(adata, min_dist=umapMinDist,maxiter = 500 if adata.shape[0] <= 10000 else 200)
            else:
                sam.run_umap(metric=distanceMetric,min_dist=umapMinDist)
                adata.obsm['X_umap'] = sam.adata.obsm['X_umap']
                adata.obsp['connectivities'] = sam.adata.obsp['connectivities']
                
            umap = adata.obsm["X_umap"]
            result = np.full((obs_mask.shape[0], umap.shape[1]), np.NaN)
            result[obs_mask] = umap
            X_umap,nnm = result, adata.obsp['connectivities'] 
            obsm = adata.obsm['X_pca']
            pca = np.full((obs_mask.shape[0], obsm.shape[1]), np.NaN)
            pca[obs_mask] = obsm
                    
    elif embeddingMode == "Create embedding from subset":
        direc = pathlib.Path().absolute()    
        umap = pickle_loader(f"{direc}/{userID}/emb/{currentLayout}.p")                     
        result = np.full((obs_mask.shape[0], umap.shape[1]), np.NaN)
        result[obs_mask] = umap[obs_mask] 
        X_umap = result  

        try:
            nnm = pickle_loader(f"{direc}/{userID}/nnm/{currentLayout}.p")[obs_mask][:,obs_mask]
        except:
            nnm = None

        try:
            obsm = pickle_loader(f"{direc}/{userID}/pca/pca;;{currentLayout}.p")
        except:
            try:
                obsm = pickle_loader(f"{direc}/{userID}/pca/pca.p")
            except:
                obsm = None
        if obsm is None:
            pca = obsm
        else:
            pca = np.full((obs_mask.shape[0], obsm.shape[1]), np.NaN)
            pca[obs_mask] = obsm[obs_mask]       

    elif embeddingMode == "Run UMAP":
        doBatch = reembedParams.get("doBatch",False)
        batchMethod = reembedParams.get("batchMethod","Scanorama")
        batchKey = reembedParams.get("batchKey","")
        scanoramaKnn = reembedParams.get("scanoramaKnn",20)
        scanoramaSigma = reembedParams.get("scanoramaSigma",15)
        scanoramaAlpha = reembedParams.get("scanoramaAlpha",0.1)
        scanoramaBatchSize = reembedParams.get("scanoramaBatchSize",5000)
        bbknnNeighborsWithinBatch = reembedParams.get("bbknnNeighborsWithinBatch",3)
        neighborsKnn = reembedParams.get("neighborsKnn",20)
        neighborsMethod = reembedParams.get("neighborsMethod","umap")
        distanceMetric = reembedParams.get("distanceMetric","cosine")
        umapMinDist = reembedParams.get("umapMinDist",0.1)
        latentSpace = reembedParams.get("latentSpace","")
            
        direc = pathlib.Path().absolute() 

        try:
            obsm = pickle_loader(f"{direc}/{userID}/pca/{latentSpace};;{currentLayout}.p")   
        except:
            obsm = pickle_loader(f"{direc}/{userID}/pca/{latentSpace}.p")   

        adata = AnnData(X=np.zeros(obsm.shape)[obs_mask],obsm={"X_pca":obsm[obs_mask]})    

        if doBatch:
            if batchMethod == "Harmony":
                sce.pp.harmony_integrate(adata,batchKey,adjusted_basis="X_pca")
            elif batchMethod == "BBKNN":
                sce.pp.bbknn(adata, batch_key=batchKey, metric=distanceMetric, n_pcs=obsm.shape[1], neighbors_within_batch=bbknnNeighborsWithinBatch)
            elif batchMethod == "Scanorama":
                sce.pp.scanorama_integrate(adata, batchKey, basis='X_pca', adjusted_basis='X_pca',
                                    knn=scanoramaKnn, sigma=scanoramaSigma, alpha=scanoramaAlpha,
                                    batch_size=scanoramaBatchSize)               
        
        if not doBatch or doBatch and batchMethod != "BBKNN":
            sc.pp.neighbors(adata, n_neighbors=neighborsKnn, use_rep="X_pca",method=neighborsMethod, metric=distanceMetric)    
        sc.tl.umap(adata, min_dist=umapMinDist,maxiter = 500 if adata.shape[0] <= 10000 else 200)
        umap = adata.obsm["X_umap"]
        nnm = adata.obsp["connectivities"]
        result = np.full((obs_mask.shape[0], umap.shape[1]), np.NaN)
        result[obs_mask] = umap 
        X_umap = result
        
        obsm = adata.obsm['X_pca']
        pca = np.full((obs_mask.shape[0], obsm.shape[1]), np.NaN)
        pca[obs_mask] = obsm        

    if embName == "":
        embName = f"umap_{str(hex(int(time.time())))[2:]}"

    if not np.all(obs_mask):
        name = f"{parentName};;{embName}"
    else:
        name = embName    
    
    if exists(f"{userID}/emb/{name}.p"):
        name = f"{name}_{str(hex(int(time.time())))[2:]}"
        

    dims = [f"{name}_0", f"{name}_1"]
    layout_schema = {"name": name, "type": "float32", "dims": dims}
    if nnm is not None:
        nnm_sub = nnm.copy()

        IXer = pd.Series(index =np.arange(nnm.shape[0]), data = np.where(obs_mask.flatten())[0])
        x,y = nnm.nonzero()
        d = nnm.data
        nnm = sp.sparse.coo_matrix((d,(IXer[x].values,IXer[y].values)),shape=(obs_mask.size,)*2).tocsr()

    direc = pathlib.Path().absolute()        
    if exists(f"{direc}/{userID}/params/latest.p"):
        latestPreParams = pickle_loader(f"{direc}/{userID}/params/latest.p")
    else:
        latestPreParams = None

    if exists(f"{userID}/params/{parentName}.p"):
        parentParams = pickle_loader(f"{direc}/{userID}/params/{parentName}.p")
    else:
        parentParams = None

    if latestPreParams is not None:
        for k in latestPreParams.keys():
            reembedParams[k] = latestPreParams[k]
            
    if (parentParams is not None):
        reembedParams[f"parentParams"]=parentParams
    
    if X_full is None:
        dataLayer = reembedParams.get("dataLayer","X")
        obs_mask = AnnDataDict['obs_mask']
        X_full = _create_data_from_shm(*shm[dataLayer])[obs_mask]
    
    if nnm is not None:
        var = dispersion_ranking_NN(X_full,nnm_sub)
        for k in var.keys():
            fn = "{}/{}/var/{};;{}.p".format(direc,userID,k.replace('/',':'),name)
            if not os.path.exists(fn.split(';;')[0]+'.p'):
                pickle_dumper(np.array(list(var[k])).astype('float'),fn.split(';;')[0]+'.p')
            pickle_dumper(np.array(list(var[k])).astype('float'),fn)
        pickle_dumper(nnm, f"{direc}/{userID}/nnm/{name}.p")
    
    pickle_dumper(X_umap, f"{direc}/{userID}/emb/{name}.p")
    pickle_dumper(reembedParams, f"{direc}/{userID}/params/{name}.p")
    if pca is not None:
        pickle_dumper(pca, f"{direc}/{userID}/pca/pca;;{name}.p")

    return layout_schema

def pickle_dumper(x,fn):
    with open(fn,"wb") as f:
        pickle.dump(x,f)

def compute_leiden(obs_mask,name,resolution,userID):
    direc = pathlib.Path().absolute() 
    nnm = pickle_loader(f"{direc}/{userID}/nnm/{name}.p")            
    nnm = nnm[obs_mask][:,obs_mask]

    X = nnm

    import igraph as ig
    import leidenalg

    adjacency = X
    sources, targets = adjacency.nonzero()
    weights = adjacency[sources, targets]
    if isinstance(weights, np.matrix):
        weights = weights.A1
    g = ig.Graph(directed=True)
    g.add_vertices(adjacency.shape[0])
    g.add_edges(list(zip(sources, targets)))
    try:
        g.es["weight"] = weights
    except BaseException:
        pass

    cl = leidenalg.find_partition(
        g, leidenalg.RBConfigurationVertexPartition, resolution_parameter=resolution,seed=0
    )
    result = np.array(cl.membership)
    clusters = np.array(["unassigned"]*obs_mask.size,dtype='object')
    clusters[obs_mask] = result.astype('str')
    return list(result)

def compute_sankey_df(labels, name, obs_mask, userID, numEdges):
    def reducer(a, b):
        result_a, inv_ndx = np.unique(a, return_inverse=True)
        result_b = np.bincount(inv_ndx, weights=b)
        return result_a, result_b        
    def cantor(a,b):
        return ((a+b)*(a+b+1)/2+b).astype('int')
    def inv_cantor(z):
        w = np.floor((np.sqrt(8*z + 1) - 1)/2)
        t = (w**2 + w)/2
        y = (z-t).astype('int')
        x = (w-y).astype('int')
        return x,y
    
    direc = pathlib.Path().absolute() 
    nnm = pickle_loader(f"{direc}/{userID}/nnm/{name}.p")              
    nnm = nnm[obs_mask][:,obs_mask]

    cl=[]
    clu = []
    rixers=[]
    unassigned_ints=[]
    for i,c in enumerate(labels):
        cl0 = np.array(['A'+str(i)+'_'+str(x).replace(' ','_').replace('(','_').replace(')','_') for x in c])
        clu0,cluc0 = np.unique(cl0,return_counts=True)
        ix = pd.Series(index=clu0,data=np.arange(clu0.size))
        cl0 = ix[cl0].values
        ll = np.arange(clu0.size)[clu0=="A"+str(i)+"_unassigned"]
        if ll.size > 0:
            unassigned_ints.append(ll[0])
        else:
            unassigned_ints.append(-1)
            
        rixers.append(pd.Series(data=clu0,index=np.arange(clu0.size)))                     
        clu0 = np.arange(clu0.size)
        clu.append((clu0,cluc0))
        cl.append(cl0)

    ps = []
    cs = []
    for i,cl1 in enumerate(cl[:-1]):
        j = i+1
        cl2 = cl[i+1]
        clu1,cluc1 = clu[i]
        clu2,cluc2 = clu[j]
        uint1 = unassigned_ints[i]
        uint2 = unassigned_ints[j]
        rixer1 = rixers[i]
        rixer2 = rixers[j]        
        
        ac = pd.Series(index=clu1,data=cluc1)
        bc = pd.Series(index=clu2,data=cluc2)

        ixer1 = pd.Series(data=np.arange(clu1.size),index=clu1)
        ixer2 = pd.Series(data=np.arange(clu2.size),index=clu2)

        xi,yi = nnm.nonzero()
        di = nnm.data

        px,py = cl1[xi],cl2[yi]
        filt = np.logical_and(px != uint1,py != uint2)
        px = px[filt]
        py = py[filt]
        dif = di[filt]

        p = cantor(px,py)

        keys,cluster_scores = reducer(p,dif)
        xc,yc = inv_cantor(keys)
        cluster_scores = cluster_scores / ac[xc].values

        xc=ixer1[xc].values
        yc=ixer2[yc].values

        CSIM = sp.sparse.coo_matrix((cluster_scores,(xc,yc)),shape=(clu1.size,clu2.size)).A


        xi,yi = nnm.nonzero()
        di = nnm.data

        px,py = cl2[xi],cl1[yi]
        filt = np.logical_and(px != uint2,py != uint1)
        px = px[filt]
        py = py[filt]
        dif = di[filt]

        p = cantor(px,py)

        keys,cluster_scores = reducer(p,dif)
        xc,yc = inv_cantor(keys)
        cluster_scores = cluster_scores / bc[xc].values


        xc=ixer2[xc].values
        yc=ixer1[yc].values

        CSIM2 = sp.sparse.coo_matrix((cluster_scores,(xc,yc)),shape=(clu2.size,clu1.size)).A


        CSIM = np.stack((CSIM,CSIM2.T),axis=2).min(2)
        
        CSIM = saturate_edges(CSIM,numEdges)
        
        x,y = CSIM.nonzero()
        d = CSIM[x,y]
        x,y = rixer1[clu1[x]].values,rixer2[clu2[y]].values
        ps.append(np.vstack((x,y)).T)
        cs.append(d)

    ps = np.vstack(ps)
    cs = np.concatenate(cs)
    ps = [list(x) for x in ps]
    cs = list(cs)     
    return {"edges":ps,"weights":cs}

def saturate_edges(CSIM,numEdges):
    IX1 = np.argsort(-CSIM,axis=1)[:,numEdges:]
    IX2 = np.argsort(-CSIM.T,axis=1)[:,numEdges:]
    CSIM[np.tile(np.arange(CSIM.shape[0])[:,None],(1,IX1.shape[1])).flatten(),IX1.flatten()] = 0
    CSIM = CSIM.T
    CSIM[np.tile(np.arange(CSIM.shape[0])[:,None],(1,IX2.shape[1])).flatten(),IX2.flatten()] = 0
    CSIM = CSIM.T
    return CSIM

def generate_correlation_map(x, y):
        mu_x = x.mean(1)
        mu_y = y.mean(1)
        n = x.shape[1]
        if n != y.shape[1]:
            raise ValueError("x and y must " + "have the same number of timepoints.")
        s_x = x.std(1, ddof=n - 1)
        s_y = y.std(1, ddof=n - 1)
        s_x[s_x == 0] = 1
        s_y[s_y == 0] = 1
        cov = np.dot(x, y.T) - n * np.dot(mu_x[:, None], mu_y[None, :])
        return cov / np.dot(s_x[:, None], s_y[None, :])

def compute_sankey_df_corr(labels, obs_mask, params, var):    
    adata = AnnData(X=_create_data_from_shm(*shm[params["dataLayer"]])[obs_mask],var=var)

    if params["samHVG"]:
        adata = adata[:,np.sort(np.argsort(-np.array(list(adata.var[params['geneMetadata']])))[:min(params['numGenes'],adata.shape[1])])]
    else:
        sc.pp.highly_variable_genes(adata,flavor='seurat_v3',n_top_genes=min(params['numGenes'],adata.shape[1]), n_bins=20)                
        adata = adata[:,adata.var['highly_variable']] 

    cl=[]
    clu = []
    for i,c in enumerate(labels):
        cl0 = np.array(['A'+str(i)+'_'+str(x).replace(' ','_').replace('(','_').replace(')','_') for x in c])
        clu0 = np.unique(cl0)
        cl.append(cl0)
        clu.append(clu0)
    
    ps=[]
    cs=[]
    for i in range(len(cl[:-1])):
        j=i+1
        c1 = cl[i]
        c2 = cl[j]
        cu1= clu[i]
        cu2 = clu[j]

        X1 = get_avgs(adata.X,c1,cu1)
        X2 = get_avgs(adata.X,c2,cu2)
        corr = generate_correlation_map(X1,X2)
        corr[corr<0]=0
        corr = saturate_edges(corr,params['numEdges'])
        x,y = corr.nonzero()
        ps.append(np.vstack((cu1[x],cu2[y])).T)
        cs.append(corr[x,y])

    ps = np.vstack(ps)
    cs = np.concatenate(cs)
    ps = [list(x) for x in ps]
    cs = list(cs)           
    return {"edges":ps,"weights":cs}

def get_avgs(X,c,cu):
    Xs=[]
    for i in cu:
        Xs.append(X[c==i].mean(0).A.flatten())
    return np.vstack(Xs)

def compute_sankey_df_corr_sg(labels, obs_mask, params, var):
    adata = AnnData(X=_create_data_from_shm(*shm[params["dataLayer"]])[obs_mask])    
    adata = adata[:,var[params["selectedGenes"]].values]

    cl=[]
    clu = []
    for i,c in enumerate(labels):
        cl0 = np.array(['A'+str(i)+'_'+str(x).replace(' ','_').replace('(','_').replace(')','_') for x in c])
        clu0 = np.unique(cl0)
        cl.append(cl0)
        clu.append(clu0)
    
    ps=[]
    cs=[]
    for i in range(len(cl[:-1])):
        j=i+1
        c1 = cl[i]
        c2 = cl[j]
        cu1= clu[i]
        cu2 = clu[j]

        X1 = get_avgs(adata.X,c1,cu1)
        X2 = get_avgs(adata.X,c2,cu2)
        corr = generate_correlation_map(X1,X2)
        corr[corr<0]=0
        corr = saturate_edges(corr,params['numEdges'])
        x,y = corr.nonzero()
        ps.append(np.vstack((cu1[x],cu2[y])).T)
        cs.append(corr[x,y])

    ps = np.vstack(ps)
    cs = np.concatenate(cs)
    ps = [list(x) for x in ps]
    cs = list(cs)     
    return {"edges":ps,"weights":cs}

def generate_coclustering_matrix(cl1,cl2):
    import scipy.sparse as sp
    vs=[]
    xs=[]
    cl = cl1
    cl = np.array(list(cl))
    clu=np.unique(cl)    
    cl = pd.Series(index=clu,data=np.arange(clu.size))[cl].values
    v = np.zeros((cl.size,clu.size))
    v[np.arange(v.shape[0]),cl]=1
    v = v.T
    su = v.sum(1)[:,None]
    su[su==0]=1
    V = v/su

    cl = cl2
    cl = np.array(list(cl))
    clu=np.unique(cl)    
    cl = pd.Series(index=clu,data=np.arange(clu.size))[cl].values
    v2 = np.zeros((cl.size,clu.size))
    v2[np.arange(v2.shape[0]),cl]=1
    v2 = v2.T
    su = v2.sum(1)[:,None]
    su[su==0]=1
    V2 = v2/su    
    
    return (V.dot(v2.T) + ( V2.dot(v.T) ).T)/2

def compute_sankey_df_coclustering(labels, obs_mask, numEdges):
    cl=[]
    clu = []
    for i,c in enumerate(labels):
        cl0 = np.array(['A'+str(i)+'_'+str(x).replace(' ','_').replace('(','_').replace(')','_') for x in c])
        clu0 = np.unique(cl0)
        cl.append(cl0)
        clu.append(clu0)
    
    ps=[]
    cs=[]
    for i in range(len(cl[:-1])):
        j = i+1
        c1 = cl[i]
        c2 = cl[j]
        cu1= clu[i]
        cu2 = clu[j]

        corr = generate_coclustering_matrix(c1,c2)
        corr = saturate_edges(corr,numEdges)        
        x,y = corr.nonzero()
        ps.append(np.vstack((cu1[x],cu2[y])).T)
        cs.append(corr[x,y])

    ps = np.vstack(ps)
    cs = np.concatenate(cs)
    ps = [list(x) for x in ps]
    cs = list(cs)     
    return {"edges":ps,"weights":cs}

def compute_preprocess(AnnDataDict, reembedParams, userID, ihm):
    layers = AnnDataDict['Xs'] 
    obs = AnnDataDict['obs']
    var = AnnDataDict['var']
    root = AnnDataDict['X_root']
    obs_mask = AnnDataDict['obs_mask']
    kkk=layers[0]
    X = _create_data_from_shm(*shm[kkk])[obs_mask]
    adata = AnnData(X=X,obs=obs[obs_mask],var=var)
    adata.layers[layers[0]] = X
    for k in layers[1:]:
        kkk=k
        X = _create_data_from_shm(*shm[kkk])[obs_mask]
        adata.layers[k] = X

    adata.obsm["X_root"] = root[obs_mask]

    doBatchPrep = reembedParams.get("doBatchPrep",False)
    batchPrepParams = reembedParams.get("batchPrepParams",{})
    batchPrepKey = reembedParams.get("batchPrepKey","")
    batchPrepLabel = reembedParams.get("batchPrepLabel","")

    doPreprocess = reembedParams.get("doPreprocess",False)
    minCountsCF = reembedParams.get("minCountsCF",0)
    minGenesCF = reembedParams.get("minGenesCF",0)
    minCellsGF = reembedParams.get("minCellsGF",0)
    maxCellsGF = reembedParams.get("maxCellsGF",100)
    minCountsGF = reembedParams.get("minCountsGF",0)
    logTransform = reembedParams.get("logTransform",False)
    dataLayer = reembedParams.get("dataLayer","X")
    sumNormalizeCells = reembedParams.get("sumNormalizeCells",False)
    
    cn = np.array(list(adata.obs["name_0"]))        
    filt = np.array([True]*adata.shape[0])
    if doBatchPrep and batchPrepKey != "" and batchPrepLabel != "":
        cl = np.array(list(adata.obs[batchPrepKey]))
        batches = np.unique(cl)
        adatas = []
        cns = []
        for k in batches:
            params = batchPrepParams[batchPrepKey].get(k,{})

            doPreprocess = params.get("doPreprocess",False)
            minCountsCF = params.get("minCountsCF",0)
            minGenesCF = params.get("minGenesCF",0)
            minCellsGF = params.get("minCellsGF",0)
            maxCellsGF = params.get("maxCellsGF",100)
            minCountsGF = params.get("minCountsGF",0)
            logTransform = params.get("logTransform",False)
            dataLayer = params.get("dataLayer","X")
            sumNormalizeCells = params.get("sumNormalizeCells",False)
            
            adata_sub = adata[cl==k].copy()
            adata_sub.obs_names = adata_sub.obs["name_0"]
            if dataLayer == "X":
                adata_sub_raw = adata_sub
                if dataLayer == "X" and "X" not in adata_sub_raw.layers.keys():
                    adata_sub_raw.layers["X"] = adata_sub_raw.X    
                adata_sub_raw.X = adata_sub_raw.layers[dataLayer]        
            else:
                adata_sub_raw = AnnData(X=adata_sub.layers[dataLayer])
                adata_sub_raw.var_names = adata_sub.var_names
                adata_sub_raw.obs_names = adata_sub.obs_names
                adata_sub_raw.obs = adata_sub.obs
                for key in adata_sub.var.keys():
                    adata_sub_raw.var[key] = adata_sub.var[key]   
            if doPreprocess:
                filt1,_ = sc.pp.filter_cells(adata_sub_raw,min_counts=minCountsCF, inplace=False)
                filt2,_ = sc.pp.filter_cells(adata_sub_raw,min_genes=minGenesCF, inplace=False)
                filt = np.logical_and(filt1,filt2)
                cns.extend(np.array(list(adata_sub_raw.obs["name_0"]))[filt])
                target_sum = np.median(np.array(adata_sub_raw.X[filt].sum(1)).flatten())
                a1,_=sc.pp.filter_genes(adata_sub_raw, min_counts=minCountsGF,inplace=False)
                a2,_=sc.pp.filter_genes(adata_sub_raw, min_cells=minCellsGF/100*adata_sub_raw.shape[0],inplace=False)
                a3,_=sc.pp.filter_genes(adata_sub_raw, max_cells=maxCellsGF/100*adata_sub_raw.shape[0],inplace=False)
                a = a1*a2*a3
                
                adata_sub_raw.X = adata_sub_raw.X.multiply(a.flatten()[None,:]).tocsr()

                if sumNormalizeCells:
                    sc.pp.normalize_total(adata_sub_raw,target_sum=target_sum)
                if logTransform:
                    try:
                        sc.pp.log1p(adata_sub_raw)  
                    except:
                        pass
            else: 
                cns.extend(np.array(list(adata_sub_raw.obs["name_0"])))

            adatas.append(adata_sub_raw)
        adata_raw = anndata.concat(adatas,axis=0,join="inner")
        filt = np.in1d(np.array(list(cn)),np.array(cns))
        temp = adata_raw.obs_names.copy()
        adata_raw.obs_names = adata_raw.obs["name_0"]
        adata_raw = adata_raw[cn]
        adata_raw.obs_names = temp
    else:
        if dataLayer == "X":
            adata_raw = adata.copy()
            if dataLayer == "X" and "X" not in adata_raw.layers.keys():
                adata_raw.layers["X"] = adata_raw.X    
            adata_raw.X = adata_raw.layers[dataLayer]        
        else:

            adata_raw = AnnData(X=adata.layers[dataLayer])
            adata_raw.var_names = adata.var_names
            adata_raw.obs_names = adata.obs_names
            adata_raw.obs = adata.obs
            for key in adata.var.keys():
                adata_raw.var[key] = adata.var[key]                
        if doPreprocess:
            filt1,_ = sc.pp.filter_cells(adata_raw,min_counts=minCountsCF, inplace=False)
            filt2,_ = sc.pp.filter_cells(adata_raw,min_genes=minGenesCF, inplace=False)
            filt = np.logical_and(filt1,filt2)
            target_sum = np.median(np.array(adata_raw.X[filt].sum(1)).flatten())
            a1,_=sc.pp.filter_genes(adata_raw, min_counts=minCountsGF,inplace=False)
            a2,_=sc.pp.filter_genes(adata_raw, min_cells=minCellsGF/100*adata_raw.shape[0],inplace=False)
            a3,_=sc.pp.filter_genes(adata_raw, max_cells=maxCellsGF/100*adata_raw.shape[0],inplace=False)
            a = a1*a2*a3
            
            adata_raw.X = adata_raw.X.multiply(a.flatten()[None,:]).tocsr()
            
            if sumNormalizeCells:
                sc.pp.normalize_total(adata_raw,target_sum=target_sum)
            if logTransform:
                try:
                    sc.pp.log1p(adata_raw) 
                except:
                    pass
        
    direc = pathlib.Path().absolute() 
   
    adata_raw.layers['X'] = adata_raw.X            
    doBatchPrep = reembedParams.get("doBatchPrep",False)
    batchPrepParams = reembedParams.get("batchPrepParams",{})
    batchPrepKey = reembedParams.get("batchPrepKey","")
    batchPrepLabel = reembedParams.get("batchPrepLabel","")

    doPreprocess = reembedParams.get("doPreprocess",False)
    minCountsCF = reembedParams.get("minCountsCF",0)
    minGenesCF = reembedParams.get("minGenesCF",0)
    minCellsGF = reembedParams.get("minCellsGF",0)
    maxCellsGF = reembedParams.get("maxCellsGF",100)
    minCountsGF = reembedParams.get("minCountsGF",0)
    logTransform = reembedParams.get("logTransform",False)
    dataLayer = reembedParams.get("dataLayer","X")
    sumNormalizeCells = reembedParams.get("sumNormalizeCells",False)

    prepParams = {
        "doBatchPrep":doBatchPrep,
        "batchPrepParams":batchPrepParams,
        "batchPrepKey":batchPrepKey,
        "batchPrepLabel":batchPrepLabel,
        "doPreprocess":doPreprocess,
        "minCountsCF":minCountsCF,
        "minGenesCF":minGenesCF,
        "minCellsGF":minCellsGF,
        "maxCellsGF":maxCellsGF,
        "minCountsGF":minCountsGF,
        "logTransform":logTransform,
        "dataLayer":dataLayer,
        "sumNormalizeCells":sumNormalizeCells,        
    }        
    pickle_dumper(prepParams, f"{direc}/{userID}/params/latest.p")
    return adata_raw
   

def initialize_socket(da):
    sock = da.socket
    @sock.route("/diffexp")
    @auth0_token_required
    def diffexp(ws):
        while True:
            data = ws.receive()
            if data is not None:  
                data = json.loads(data)
                obsFilterA = data.get("set1", {"filter": {}})["filter"]
                obsFilterB = data.get("set2", {"filter": {}})["filter"]
                layer = data.get("layer","X")
                top_n = data.get("count", 100)
                lfc_cutoff = 0.01
                shape = da.get_shape()

                obs_mask_A = da._axis_filter_to_mask(Axis.OBS, obsFilterA["obs"], shape[0])
                obs_mask_B = da._axis_filter_to_mask(Axis.OBS, obsFilterB["obs"], shape[0])      

                tMean = da.data.var[f'{layer};;tMean'].values
                tMeanSq = da.data.var[f'{layer};;tMeanSq'].values     
                annotations = da.dataset_config.user_annotations        
                direc = pathlib.Path().absolute()                       
                userID = f"{annotations._get_userdata_idhash(da)}"  
                fnn=data['groupName'].replace('/',':')
                if not os.path.exists(f"{direc}/{userID}/diff/{fnn}"):
                    os.makedirs(f"{direc}/{userID}/diff/{fnn}")
                if not data.get('multiplex',None):
                    pickle_dumper(np.where(obs_mask_A)[0],f"{direc}/{userID}/diff/{fnn}/Pop1 high.p")
                    pickle_dumper(np.where(obs_mask_B)[0],f"{direc}/{userID}/diff/{fnn}/Pop2 high.p")
                else:
                    fnn2=data['category'].replace('/',':')                                    
                    pickle_dumper(np.where(obs_mask_A)[0],f"{direc}/{userID}/diff/{fnn}/{fnn2}.p")

                _multiprocessing_wrapper(da,ws,compute_diffexp_ttest, "diffexp",data,None,layer,tMean,tMeanSq,obs_mask_A,obs_mask_B,top_n,lfc_cutoff, current_app.hosted_mode)
    
    @sock.route("/reembedding")
    @auth0_token_required
    def reembedding(ws):
        while True:
            data = ws.receive()
            if data is not None:  
                data = json.loads(data)

                filter = data["filter"]
                if (not current_app.hosted_mode) or (current_app.hosted_mode and (len(filter["obs"]["index"]) <= 50000)): 
                    reembedParams = data["params"] if data else {}
                    parentName = data["parentName"] if data else ""
                    embName = data["embName"] if data else None
                    currentLayout = data["currentLayout"]
        
                    annotations = da.dataset_config.user_annotations        
                    userID = f"{annotations._get_userdata_idhash(da)}"  
                    layers = []
                    batchKey = reembedParams.get("batchKey","")
                    doBatchPrep = reembedParams.get("doBatchPrep",False)
                    batchPrepParams = reembedParams.get("batchPrepParams",{})
                    batchPrepKey = reembedParams.get("batchPrepKey","")
                    batchPrepLabel = reembedParams.get("batchPrepLabel","")
                    dataLayer = reembedParams.get("dataLayer","X")
                    OBS_KEYS = ["name_0"]
                    if doBatchPrep and batchPrepKey != "" and batchPrepLabel != "":
                        cl = np.array(list(da.data.obs[batchPrepKey]))
                        batches = np.unique(cl)
                        for k in batches:
                            params = batchPrepParams[batchPrepKey].get(k,{})
                            k = params.get("dataLayer","X")
                            layers.append(k)
                    else:
                        layers.append(dataLayer)
                    
                    if batchKey != "":
                        OBS_KEYS.append(batchKey)

                    layers = list(np.unique(layers))
                    direc = pathlib.Path().absolute()  

                    obs = pd.DataFrame()
                    for k in OBS_KEYS:
                        obs[k] = pickle_loader(f"{direc}/{userID}/obs/{k}.p")
                    obs.index = pd.Index(np.arange(obs.shape[0]))
                    
                    fnames = glob(f"{direc}/{userID}/var/*.p")
                    v = pickle_loader(f"{direc}/{userID}/var/name_0.p")
                    var = pd.DataFrame(data=v[:,None],index=v,columns=["name_0"])
                    for f in fnames:
                        n = f.split('/')[-1].split('\\')[-1][:-2]
                        if ';;' in n:
                            tlay = n.split(';;')[-1]
                        else:
                            tlay = parentName

                        if parentName == tlay:
                            l = pickle_loader(f"{direc}/{userID}/var/{n}.p")
                            if n != "name_0":
                                var[n] = pd.Series(l)
                    del var['name_0']
                    
                    AnnDataDict = {
                        "Xs": layers,
                        "obs": obs,
                        "var": var,
                        "X_root":da._obsm_init[da.rootName],
                        "obs_mask": da._axis_filter_to_mask(Axis.OBS, filter["obs"], da.get_shape()[0])
                    }

                    def post_processing(res):
                        return {"layoutSchema": res, "schema": common_rest.schema_get_helper(da, userID = userID)}                        

                    _multiprocessing_wrapper(da,ws,compute_embedding, "reembedding",data,post_processing,AnnDataDict, reembedParams, parentName, embName, currentLayout, userID, current_app.hosted_mode)
    
    @sock.route("/sankey")
    def sankey(ws):
        while True:
            data = ws.receive()
            if data is not None:  
                data = json.loads(data)
                labels = data.get("labels", None)
                name = data.get("name", None)
                filter = data.get("filter",None)
                params = data.get("params",{"samHVG": False,"numGenes": 2000, "sankeyMethod": "Graph alignment", "selectedGenes": [], "dataLayer": "X", "numEdges": 5})
                annotations = da.dataset_config.user_annotations        
                userID = f"{annotations._get_userdata_idhash(da)}"  
               
                direc = pathlib.Path().absolute()   
                fnames = glob(f"{direc}/{userID}/var/*.p")
                v = pickle_loader(f"{direc}/{userID}/var/name_0.p")
                var = pd.DataFrame(data=v[:,None],index=v,columns=["name_0"])
                for f in fnames:
                    n = f.split('/')[-1].split('\\')[-1][:-2]
                    if ';;' in n:
                        tlay = n.split(';;')[-1]
                    else:
                        tlay = name

                    if name == tlay:
                        l = pickle_loader(f"{direc}/{userID}/var/{n}.p")
                        if n != "name_0":
                            var[n] = pd.Series(l)
                del var['name_0']
                                                              
                obs_mask = da._axis_filter_to_mask(Axis.OBS, filter["obs"], da.get_shape()[0])
                if params["sankeyMethod"] == "Graph alignment":
                    _multiprocessing_wrapper(da,ws,compute_sankey_df, "sankey",data,None,labels, name, obs_mask, userID, params['numEdges'])              
                elif params["sankeyMethod"] == "Correlation":
                    _multiprocessing_wrapper(da,ws,compute_sankey_df_corr, "sankey",data,None,labels, obs_mask, params, var)
                elif params["sankeyMethod"] == "Correlation (selected genes)":
                    _multiprocessing_wrapper(da,ws,compute_sankey_df_corr_sg, "sankey",data,None,labels, obs_mask, params,pd.Series(index=v,data=np.arange(var.shape[0])))
                elif params["sankeyMethod"] == "Co-labeling":
                    _multiprocessing_wrapper(da,ws,compute_sankey_df_coclustering, "sankey",data,None,labels, obs_mask, params['numEdges'])                                        

    @sock.route("/downloadAnndata")
    @auth0_token_required
    def downloadAnndata(ws):
        while True:
            data = ws.receive()
            if data is not None:  
                data = json.loads(data)
                labelNames = data.get("labelNames",None)
                currentLayout = data.get("currentLayout",None)
                filter = data["filter"] if data else None

                shape = da.get_shape()
                obs_mask = da._axis_filter_to_mask(Axis.OBS, filter["obs"], shape[0])

                annotations = da.dataset_config.user_annotations        
                userID = f"{annotations._get_userdata_idhash(da)}" 
                
                layers = list(da.data.layers.keys())
                varm = {}
                for k in da.data.varm.keys():
                    varm[k] = da.data.varm[k]

                AnnDataDict={"Xs":layers, "varm": varm}

                _multiprocessing_wrapper(da,ws,save_data, "downloadAnndata",data,None,AnnDataDict,labelNames,np.array(list(da.data.obs['name_0'])),currentLayout,obs_mask,userID, current_app.hosted_mode)

 
    @sock.route("/leiden")
    @auth0_token_required
    def leiden(ws):
        while True:
            data = ws.receive()
            if data is not None:  
                data = json.loads(data)
                name = data.get("name", None)
                resolution = data.get('resolution',1.0)
                filter = data.get('filter',None)
                annotations = da.dataset_config.user_annotations        
                userID = f"{annotations._get_userdata_idhash(da)}"  
                obs_mask = da._axis_filter_to_mask(Axis.OBS, filter["obs"], da.get_shape()[0])

                _multiprocessing_wrapper(da,ws,compute_leiden, "leiden",data,None,obs_mask,name,resolution,userID)

@njit(parallel=True)
def _partial_summer(d,x,ptr,m,inc,ninc, calculate_sq=True):
    htable = Dict.empty(
        key_type=types.int64,
        value_type=types.boolean,
    )    
    for i in inc:
        htable[i] = True
    
    for i in ninc:
        htable[i] = False
        
    res = np.zeros(m)
    res2 = np.zeros(m)
    for i in prange(m):
        di = d[ptr[i] : ptr[i+1]]
        xi = x[ptr[i] : ptr[i+1]]
        s=0
        if calculate_sq:
            s2 = 0
        for j in prange(xi.size):
            s += di[j] if htable[xi[j]] else 0
            if calculate_sq:
                s2 += di[j]**2 if htable[xi[j]] else 0
                
        res[i] = s
        if calculate_sq:
            res2[i] = s2
    return res,res2

@njit(parallel=True)
def _fmt_swapper(indices,indptr,data,n):#x,y,d,ptr):
    pair = np.zeros_like(indices)
    for i in prange(indptr.size):
        pair[indptr[i]:indptr[i+1]]=i

    indptr2 = np.zeros(n,dtype=indices.dtype)
    for i in range(indices.size):
        indptr2[indices[i]+1]+=1
    indptr2 = np.cumsum(indptr2)

    res = np.zeros_like(pair)
    dres = np.zeros_like(data)
    indptr3 = indptr2[:-1].copy()  
    for i in range(indices.size):
        j = indices[i]
        k = indptr3[j]
        res[k]=pair[i]
        dres[k]=data[i]
        indptr3[j]+=1
    return dres,res,indptr2

def fmt_swapper(X):
    import scipy as sp
    if X.getformat()=="csc":
        return sp.sparse.csr_matrix(_fmt_swapper(X.indices,X.indptr,X.data,X.shape[0]+1),shape=X.shape)
    elif X.getformat()=="csr":
        return sp.sparse.csc_matrix(_fmt_swapper(X.indices,X.indptr,X.data,X.shape[1]+1),shape=X.shape)

def _create_shm(X,dtype):
    ra = RawArray(dtype,X.size)
    ntype = "int32" if dtype == "I" else "float32"
    X_np = np.frombuffer(ra, dtype = ntype)
    np.copyto(X_np, X)
    return ra

def _create_shm_from_data(X):
    a = _create_shm(X.indices,'I')
    b = _create_shm(X.indptr,'I')
    c = _create_shm(X.data,'f')    
    return (a,b,c,X.shape)


def _create_data_from_shm(a,b,c,Xsh):
    indices = np.frombuffer(a,"int32")
    indptr = np.frombuffer(b,"int32")
    data = np.frombuffer(c,"float32")
    return sp.sparse.csr_matrix((data,indices,indptr),shape=Xsh)

def _create_data_from_shm_csc(a,b,c,Xsh):
    indices = np.frombuffer(a,"int32")
    indptr = np.frombuffer(b,"int32")
    data = np.frombuffer(c,"float32")
    return sp.sparse.csc_matrix((data,indices,indptr),shape=Xsh)

def _initializer(ishm,ishm_csc):
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    global shm
    global shm_csc
    shm = ishm
    shm_csc = ishm_csc

def dispersion_ranking_NN(X, nnm, weight_mode='rms'):
    import scipy.sparse as sp

    f = nnm.sum(1).A
    f[f==0]=1
    D_avg = (nnm.multiply(1 / f)).dot(X)

    if sp.issparse(D_avg):
        mu, var = sf.mean_variance_axis(D_avg, axis=0)            
        if weight_mode == 'rms':
            D_avg.data[:]=D_avg.data**2
            mu,_ =sf.mean_variance_axis(D_avg, axis=0)
            mu=mu**0.5
            
        if weight_mode == 'combined':
            D_avg.data[:]=D_avg.data**2
            mu2,_ =sf.mean_variance_axis(D_avg, axis=0)
            mu2=mu2**0.5                
    else:
        mu = D_avg.mean(0)
        var = D_avg.var(0)
            
    VARS = {}
    if weight_mode == 'dispersion' or weight_mode == 'rms' or weight_mode == 'combined':
        dispersions = np.zeros(var.size)
        dispersions[mu > 0] = var[mu > 0] / mu[mu > 0]
        VARS["sam_spatial_dispersions"] = dispersions.copy()
        
        if weight_mode == 'combined':
            dispersions2 = np.zeros(var.size)
            dispersions2[mu2 > 0] = var[mu2 > 0] / mu2[mu2 > 0]
            

    elif weight_mode == 'variance':
        dispersions = var
        VARS["sam_spatial_variances"] = dispersions.copy()
    else:
        raise ValueError('`weight_mode` ',weight_mode,' not recognized.')

    ma = dispersions.max()
    dispersions[dispersions >= ma] = ma

    weights = ((dispersions / dispersions.max()) ** 0.5).flatten()
    
    if weight_mode == 'combined':
        ma = dispersions2.max()
        dispersions2[dispersions2 >= ma] = ma

        weights2 = ((dispersions2 / dispersions2.max()) ** 0.5).flatten()
        weights = np.vstack((weights,weights2)).max(0)
    VARS['sam_weights']=weights
    return VARS

class AnndataAdaptor(DataAdaptor):

    def __init__(self, data_locator, app_config=None, dataset_config=None):
        super().__init__(data_locator, app_config, dataset_config)
        self.data = None

        self._load_data(data_locator, root_embedding=app_config.root_embedding, preprocess=app_config.preprocess)    
        self._create_pool()

        print("Validating and initializing...")
        self._validate_and_initialize()

    def _create_pool(self):
        self.pool = Pool(os.cpu_count(), initializer=_initializer, initargs=(self.shm_layers_csr,self.shm_layers_csc), maxtasksperchild=None)
    def _reset_pool(self):
        self.pool.close()
        self.pool.terminate()
        self.pool.join()
        self._create_pool()
    
    def cleanup(self):
        pass

    @staticmethod
    def pre_load_validation(data_locator):
        if data_locator.islocal():
            # if data locator is local, apply file system conventions and other "cheap"
            # validation checks.  If a URI, defer until we actually fetch the data and
            # try to read it.  Many of these tests don't make sense for URIs (eg, extension-
            # based typing).
            if not data_locator.exists():
                raise DatasetAccessError("does not exist")

    @staticmethod
    def file_size(data_locator):
        return data_locator.size() if data_locator.islocal() else 0

    @staticmethod
    def open(data_locator, app_config, dataset_config=None):
        return AnndataAdaptor(data_locator, app_config, dataset_config)

    def get_corpora_props(self):
        return corpora_get_props_from_anndata(self.data)

    def get_name(self):
        return "cellxgene anndata adaptor version"

    def get_library_versions(self):
        return dict(anndata=str(anndata.__version__))

    @staticmethod
    def _create_unique_column_name(df, col_name_prefix):
        """given the columns of a dataframe, and a name prefix, return a column name which
        does not exist in the dataframe, AND which is prefixed by `prefix`

        The approach is to append a numeric suffix, starting at zero and increasing by
        one, until an unused name is found (eg, prefix_0, prefix_1, ...).
        """
        suffix = 0
        while f"{col_name_prefix}{suffix}" in df:
            suffix += 1
        return f"{col_name_prefix}{suffix}"

    def compute_diffexp_ttest(self):
        pass

    def compute_embedding(self):
        pass

    def compute_sankey_df(self):
        pass

    def compute_leiden(self):
        pass

    def _alias_annotation_names(self):
        """
        The front-end relies on the existance of a unique, human-readable
        index for obs & var (eg, var is typically gene name, obs the cell name).
        The user can specify these via the --obs-names and --var-names config.
        If they are not specified, use the existing index to create them, giving
        the resulting column a unique name (eg, "name").

        In both cases, enforce that the result is unique, and communicate the
        index column name to the front-end via the obs_names and var_names config
        (which is incorporated into the schema).
        """
        self.original_obs_index = self.data.obs.index

        for (ax_name, var_name) in ((Axis.OBS, "obs"), (Axis.VAR, "var")):
            config_name = f"single_dataset__{var_name}_names"
            parameter_name = f"{var_name}_names"
            name = getattr(self.server_config, config_name)
            df_axis = getattr(self.data, str(ax_name))
            if name is None:
                # Default: create unique names from index
                if not df_axis.index.is_unique:
                    raise KeyError(
                        f"Values in {ax_name}.index must be unique. "
                        "Please prepare data to contain unique index values, or specify an "
                        "alternative with --{ax_name}-name."
                    )
                name = self._create_unique_column_name(df_axis.columns, "name_")
                self.parameters[parameter_name] = name
                # reset index to simple range; alias name to point at the
                # previously specified index.
                df_axis.rename_axis(name, inplace=True)
                df_axis.reset_index(inplace=True)
            elif name in df_axis.columns:
                # User has specified alternative column for unique names, and it exists
                if not df_axis[name].is_unique:
                    raise KeyError(
                        f"Values in {ax_name}.{name} must be unique. " "Please prepare data to contain unique values."
                    )
                df_axis.reset_index(drop=True, inplace=True)
                self.parameters[parameter_name] = name
            else:
                # user specified a non-existent column name
                raise KeyError(f"Annotation name {name}, specified in --{ax_name}-name does not exist.")

    def _load_data(self, data_locator, preprocess=False, root_embedding = None):
        with data_locator.local_handle() as lh:
            backed = "r" if self.server_config.adaptor__anndata_adaptor__backed else None

            # load data from variety of formats
            if os.path.isdir(lh) and len(glob(lh+'/*.gz'))==0:
                filenames = glob(lh+'/*')
                adatas = []
                batch = []
                for file in filenames:
                    if os.path.isdir(file):
                        backed=False
                
                for file in filenames:
                    if os.path.isdir(file):
                        adata = sc.read_10x_mtx(file)
                        filt1,_ = sc.pp.filter_cells(adata,min_counts=100, inplace=False)
                        filt2,_ = sc.pp.filter_cells(adata,min_genes=100, inplace=False)
                        filt = np.logical_and(filt1,filt2)
                        adata = adata[filt].copy()
                    elif file.split('.')[-1] =='csv':
                        adata = sc.read_csv(file) 
                        adata.X = sp.sparse.csc_matrix(adata.X)
                    else:
                        adata = anndata.read_h5ad(file, backed=backed)

                    adatas.append(adata)
                    batch.append([file.split('.h5ad')[0].split('/')[-1].split('\\')[-1]]*adata.shape[0])
                
                adata = anndata.concat(adatas,join='inner',axis=0)
                if "orig.ident" not in adata.obs.keys():
                    key = "orig.ident"
                else:
                    key = f"orig.ident.{str(hex(int(time.time())))[2:]}"
                adata.obs[key] = pd.Categorical(np.concatenate(batch))
            elif len(glob(lh+'/*.gz'))>0:
                adata = sc.read_10x_mtx(lh)
            else:
                adata = anndata.read_h5ad(lh, backed=backed)


            if not sparse.issparse(adata.X):
                adata.X = sparse.csr_matrix(adata.X)

            for k in adata.layers.keys():  
                if not sparse.issparse(adata.layers[k]):
                    adata.layers[k] = sparse.csr_matrix(adata.layers[k])

            if preprocess:
                target_sum = np.median(np.array(adata.X.sum(1)).flatten())
                adata.layers['raw_counts'] = adata.X.copy()
                sc.pp.normalize_total(adata,target_sum=target_sum)                
                sc.pp.log1p(adata)
                adata.layers['X'] = adata.X
                
            self.rootName = self.find_valid_root_embedding(adata.obsm)
            if root_embedding is not None:
                if root_embedding in adata.obsm.keys():
                    if np.isnan(adata.obsm[root_embedding]).sum()>0:
                        if self.rootName == "X_root":
                            adata.obsm[self.rootName] = np.zeros((adata.shape[0],2))
                    else:
                        self.rootName = root_embedding
                else:
                    if self.rootName == "X_root":
                        adata.obsm[self.rootName] = np.zeros((adata.shape[0],2))
            else:
                if self.rootName == "X_root":
                    adata.obsm[self.rootName] = np.zeros((adata.shape[0],2))            
            
            adata.obs_names_make_unique()

            # cast all expressions to float32 if they're not already
            if adata.X.dtype != "float32":
                adata.X = adata.X.astype('float32')
            for k in adata.layers.keys():
                if adata.layers[k].dtype != "float32":
                    adata.layers[k] = adata.layers[k].astype('float32')

            adata.layers["X"] = adata.X
            if adata.raw is not None:
                #adata.layers[".raw"] = adata.raw.X
                del adata.raw
                gc.collect()

            if 'connectivities' in adata.obsp.keys():
                print('Found connectivities adjacency matrix. Computing SAM gene weights...')
                var = dispersion_ranking_NN(adata.X,adata.obsp['connectivities'])
                for k in var.keys():
                    adata.var[k]=var[k]

            print("Loading and precomputing layers necessary for fast differential expression and reembedding...")
            self.shm_layers_csr = {}
            self.shm_layers_csc = {}
            for k in adata.layers.keys():
                print("Layer",k,"...")
                if adata.X.getformat() == "csr":
                    self.shm_layers_csr[k] = _create_shm_from_data(adata.layers[k])
                    self.shm_layers_csc[k] = _create_shm_from_data(fmt_swapper(adata.layers[k]))
                elif adata.X.getformat() != "csc":
                    self.shm_layers_csr[k] = _create_shm_from_data(adata.layers[k].tocsr())
                    self.shm_layers_csc[k] = _create_shm_from_data(adata.layers[k].tocsc())                        
                else:
                    self.shm_layers_csc[k] = _create_shm_from_data(adata.layers[k])
                    self.shm_layers_csr[k] = _create_shm_from_data(fmt_swapper(adata.layers[k]))                                                                 
                
                mean,v = sf.mean_variance_axis(adata.layers[k],axis=0)
                meansq = v-mean**2
                adata.var[f"{k};;tMean"] = mean
                adata.var[f"{k};;tMeanSq"] = meansq

                adata.layers[k] = sp.sparse.csc_matrix(adata.shape).astype('float32')
                gc.collect()
            adata.X = sp.sparse.csc_matrix(adata.shape).astype('float32')
            gc.collect()
            
            for curr_axis in [adata.obs,adata.var]:
                for ann in curr_axis:
                    dtype = curr_axis[ann].dtype
                    if hasattr(dtype,'numpy_dtype'):
                        dtype = dtype.numpy_dtype
                    curr_axis[ann] = curr_axis[ann].astype(dtype)
            
            self.data = adata
            print("Finished loading the data.")
    
    def find_valid_root_embedding(self,obsm):
        root = "X_root"
        for k in obsm.keys():
            if np.isnan(obsm[k]).sum()==0:
                root = k
                break
        return root

    def _initialize_user_folders(self,userID):
        if not os.path.exists("output/"):
            os.makedirs("output/")

        if not os.path.exists(f"{userID}/"):
            os.makedirs(f"{userID}/nnm/")
            os.makedirs(f"{userID}/emb/")
            os.makedirs(f"{userID}/params/")
            os.makedirs(f"{userID}/pca/")
            os.makedirs(f"{userID}/obs/")
            os.makedirs(f"{userID}/var/")
            os.makedirs(f"{userID}/diff/")

            for k in self._obs_init.keys():
                vals = np.array(list(self._obs_init[k]))
                if isinstance(vals[0],np.integer):
                    vals = vals.astype('str')

                pickle_dumper(vals,"{}/obs/{}.p".format(userID,k.replace('/',':')))
            pickle_dumper(np.array(list(self._obs_init.index)),f"{userID}/obs/name_0.p")                                
            for k in self._var_init.keys():
                pickle_dumper(np.array(list(self._var_init[k])),"{}/var/{}.p".format(userID,k.replace('/',':')))
            pickle_dumper(np.array(list(self._var_init.index)),f"{userID}/var/name_0.p")                

            for k in self._obsm_init.keys():
                k2 = "X_".join(k.split("X_")[1:])
                pickle_dumper(self._obsm_init[k],f"{userID}/emb/{k2}.p")
                if self._obsm_init[k].shape[1] > 2:
                    pickle_dumper(self._obsm_init[k],f"{userID}/pca/{k2}.p")

                r = self._obsp_init.get("N_"+k2,self._obsp_init.get("connectivities",None))
                p = self._uns_init.get("N_"+k2+"_params",{})
                if r is not None:
                    pickle_dumper(r,f"{userID}/nnm/{k2}.p")
                    pickle_dumper(p,f"{userID}/params/{k2}.p")
             

    def _validate_and_initialize(self):
        if anndata_version_is_pre_070():
            warnings.warn(
                "Use of anndata versions older than 0.7 will have serious issues. Please update to at "
                "least anndata 0.7 or later."
            )

        # var and obs column names must be unique
        if not self.data.obs.columns.is_unique or not self.data.var.columns.is_unique:
            raise KeyError("All annotation column names must be unique.")

        self._alias_annotation_names()
        self._validate_data_types()
        self.cell_count = self.data.shape[0]
        self.gene_count = self.data.shape[1]

        for k in self.data.obs.columns:
            x = np.array(list(self.data.obs[k]))
            if not np.issubdtype(x.dtype,np.number):
                x = x.astype('str')
                self.data.obs[k] = pd.Categorical(x)
            else:
                if np.any(np.isnan(x)):
                    x = x.astype('str')
                    self.data.obs[k] = pd.Categorical(x)
        
            #sam.adata.obs[k] = pd.Categorical(sam.adata.obs[k].astype('str'))        
        self._obsm_init = self.data.obsm
        self._obs_init = self.data.obs
        l = []
        for i in self.data.var.keys():
            if ";;tMean" in i:
                l.append(i)
        self._var_init = self.data.var.drop(labels=l,axis=1)
        self._uns_init = self.data.uns
        self._obsp_init = self.data.obsp

        del self.data.obs
        del self.data.obsm
        del self.data.uns
        del self.data.obsp

        self.data.obsm[self.rootName] = self._obsm_init[self.rootName]
        self.data.obs["name_0"] = self._obs_init["name_0"]
        self.data.var["name_0"] = self._var_init["name_0"]

        self._obs_init = self._obs_init.set_index("name_0")
        self._var_init = self._var_init.set_index("name_0")


        # heuristic
        n_values = self.data.shape[0] * self.data.shape[1]
        if (n_values > 1e8 and self.server_config.adaptor__anndata_adaptor__backed is True) or (n_values > 5e8):
            self.parameters.update({"diffexp_may_be_slow": True})


        id = (self.get_location()).encode()
        self.guest_idhash = base64.b32encode(blake2b(id, digest_size=5).digest()).decode("utf-8")

        print("Initializing user folders")
        self._initialize_user_folders(self.guest_idhash)

    def _is_valid_layout(self, arr):
        """return True if this layout data is a valid array for front-end presentation:
        * ndarray, dtype float/int/uint
        * with shape (n_obs, >= 2)
        * with all values finite or NaN (no +Inf or -Inf)
        """
        is_valid = type(arr) == np.ndarray and arr.dtype.kind in "fiu"
        is_valid = is_valid and arr.shape[0] == self.data.n_obs and arr.shape[1] >= 2
        is_valid = is_valid and not np.any(np.isinf(arr)) and not np.all(np.isnan(arr))
        return is_valid

    def _validate_data_types(self):
        # The backed API does not support interrogation of the underlying sparsity or sparse matrix type
        # Fake it by asking for a small subarray and testing it.   NOTE: if the user has ignored our
        # anndata <= 0.7 warning, opted for the --backed option, and specified a large, sparse dataset,
        # this "small" indexing request will load the entire X array. This is due to a bug in anndata<=0.7
        # which will load the entire X matrix to fullfill any slicing request if X is sparse.  See
        # user warning in _load_data().
        X0 = self.data.X[0, 0:1]
        if sparse.isspmatrix(X0) and not sparse.isspmatrix_csc(X0):
            warnings.warn(
                "Anndata data matrix is sparse, but not a CSC (columnar) matrix.  "
                "Performance may be improved by using CSC."
            )
        if self.data.X.dtype != "float32":
            warnings.warn(
                f"Anndata data matrix is in {self.data.X.dtype} format not float32. " f"Precision may be truncated."
            )
        for ax in Axis:
            curr_axis = getattr(self.data, str(ax))
            for ann in curr_axis:
                datatype = curr_axis[ann].dtype
                downcast_map = {
                    "int64": "int32",
                    "uint32": "int32",
                    "uint64": "int32",
                    "float64": "float32",
                }
                """                
                if datatype in downcast_map:
                    warnings.warn(
                        f"Anndata annotation {ax}:{ann} is in unsupported format: {datatype}. "
                        f"Data will be downcast to {downcast_map[datatype]}."
                    )
                if isinstance(datatype, CategoricalDtype):
                    category_num = len(curr_axis[ann].dtype.categories)
                    if category_num > 500 and category_num > self.dataset_config.presentation__max_categories:
                        warnings.warn(
                            f"{str(ax).title()} annotation '{ann}' has {category_num} categories, this may be "
                            f"cumbersome or slow to display. We recommend setting the "
                            f"--max-category-items option to 500, this will hide categorical "
                            f"annotations with more than 500 categories in the UI"
                        )"""

    def annotation_to_fbs_matrix(self, axis, fields=None, labels=None):
        if axis == Axis.OBS:
            if labels is not None and not labels.empty:
                labels["name_0"] = list(self.data.obs["name_0"])
                df = labels
            else:
                df = self.data.obs
        else:
            if labels is not None and not labels.empty:
                labels["name_0"] = list(self.data.var["name_0"])
                df = labels
            else:
                df = self.data.var
        
        if fields is not None and len(fields) > 0:
            df = df[fields]
        
        return encode_matrix_fbs(df, col_idx=df.columns)

    def get_embedding_names(self):
        """
        Return pre-computed embeddings.

        function:
            a) generate list of default layouts
            b) validate layouts are legal.  remove/warn on any that are not
            c) cap total list of layouts at global const MAX_LAYOUTS
        """
        # load default layouts from the data.
        layouts = self.dataset_config.embeddings__names

        if layouts is None or len(layouts) == 0:
            layouts = [key[2:] for key in self.data.obsm_keys() if type(key) == str and key.startswith("X_")]

        # remove invalid layouts
        valid_layouts = []
        obsm_keys = self.data.obsm_keys()
        for layout in layouts:
            layout_name = f"X_{layout}"
            if layout_name not in obsm_keys:
                warnings.warn(f"Ignoring unknown layout name: {layout}.")
            elif not self._is_valid_layout(self.data.obsm[layout_name]):
                warnings.warn(f"Ignoring layout due to malformed shape or data type: {layout}")
            else:
                valid_layouts.append(layout)
        # cap layouts to MAX_LAYOUTS
        return valid_layouts[0:MAX_LAYOUTS]

    def get_embedding_array(self, ename, dims=2):
        annotations = self.dataset_config.user_annotations        
        userID = f"{annotations._get_userdata_idhash(self)}"
        try:
            full_embedding = pickle_loader(f"{userID}/emb/{ename}.p")
        except:
            full_embedding = self._obsm_init[f"X_{ename}"]
        return full_embedding[:, 0:dims]

    def get_colors(self):
        return convert_anndata_category_colors_to_cxg_category_colors(self.data)

    def get_X_array(self, col_idx, layer="X", logscale=False):
        def bisym_log_transform(x):
             return np.sign(x)*np.log(1+np.abs(x))

        #if row_idx is None:
        #    row_idx = np.arange(self.data.shape[0])
        XI = _create_data_from_shm_csc(*self.shm_layers_csc[layer])

        if col_idx is None:
            col_idx = np.arange(self.data.shape[1])        
        
        if col_idx.size == 1:
            i1 = col_idx[0]
                            
            d = XI.data[XI.indptr[i1] : XI.indptr[i1 + 1]]
            i = XI.indices[XI.indptr[i1] : XI.indptr[i1 + 1]]
            x = np.zeros(XI.shape[0])
            x[i] = d
            x=x[:,None]
            if logscale:
                x = bisym_log_transform(x)
            #x=x[row_idx][:,None]                
        else:
            x = XI[:,col_idx]
            if logscale:
                if sparse.issparse(x):
                    x.data[:] = bisym_log_transform(x.data)
                else:
                    x = bisym_log_transform(x)
        return x

    def get_shape(self):
        return self.data.shape

    def query_var_array(self, term_name):
        return getattr(self.data.var, term_name)

    def query_obs_array(self, term_name):
        return getattr(self.data.obs, term_name)

    def get_obs_index(self):
        name = self.server_config.single_dataset__obs_names
        if name is None:
            return self.original_obs_index
        else:
            return self.data.obs[name]

    def get_obs_columns(self):
        return self.data.obs.columns

    def get_obs_keys(self):
        # return list of keys
        return self.data.obs.keys().to_list()

    def get_var_keys(self):
        # return list of keys
        return self.data.var.keys().to_list()

