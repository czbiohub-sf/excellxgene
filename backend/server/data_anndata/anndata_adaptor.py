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
from sklearn.preprocessing import StandardScaler
from server_timing import Timing as ServerTiming
import igraph as ig
import leidenalg
import time
from sklearn.decomposition import PCA
import os
import gc
from glob import glob
import scanpy as sc
import scanpy.external as sce
import samalg.utilities as ut
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
from multiprocessing import Pool, RawArray, TimeoutError
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
from numba import njit, prange, config, threading_layer
from numba.core import types
from numba.typed import Dict
from sklearn.utils import check_array, check_random_state, sparsefuncs as sf
from sklearn.utils.validation import _check_psd_eigenvalues
from sklearn.utils.extmath import svd_flip



if current_process().name == 'MainProcess':
    print("Configuring multiprocessing spawner...")
    if True or sys.platform.startswith('linux'):
        set_start_method("fork")


global active_processes
active_processes = {}

global process_count
process_count = 0

anndata_version = version.parse(str(anndata.__version__)).release

def _init_arpack_v0(size, random_state):
    random_state = check_random_state(random_state)
    v0 = random_state.uniform(-1, 1, size)
    return v0

def kpca(XL,npcs=150,seed=0,which='LA'):
    random_init = _init_arpack_v0(XL.shape[1],seed)
    w, u = sp.sparse.linalg.eigsh(XL, which=which, k=npcs, v0=random_init)
    u, _ = svd_flip(u,np.zeros_like(u).T)

    indices = w.argsort()[::-1]
    w = w[indices]
    u = u[:, indices]*w**0.5
    w= _check_psd_eigenvalues(w,enable_warnings=False) 
    return u

def kernel_svd(K, k=100, seed=0):
    K = check_array(K, accept_sparse=['csr', 'csc'])
    K=(K+K.T)/2
    H = get_centering_operator(K)
    XL = get_linear_operator((H,K,H))
    return kpca(XL,npcs=k,seed=seed)

def get_centering_operator(X):
    ones = np.ones(X.shape[0])[None, :].dot
    onesT = np.ones(X.shape[0])[:, None].dot    
    O = sp.sparse.diags(np.ones(X.shape[0])).tocsr()

    def p(x):
        return O.dot(x) - onesT(ones(x))/X.shape[0]

    H = sp.sparse.linalg.LinearOperator(
        matvec=p,
        dtype=X.dtype,
        matmat=p,
        shape=(X.shape[0],X.shape[0]),
        rmatvec=p,
        rmatmat=p,
    )
    return H

def get_linear_operator(matrices):
    def p(x):
        v = matrices[-1].dot(x)
        for m in matrices[::-1][1:]:
            v = m.dot(v)
        return v
    
    def pt(x):
        v = matrices[0].T.dot(x)
        for m in matrices[1:]:
            v = m.T.dot(v)
        return v
    
    H = sp.sparse.linalg.LinearOperator(
        matvec=p,
        dtype=matrices[0].dtype,
        matmat=p,
        shape=(matrices[0].shape[0],matrices[-1].shape[1]),
        rmatvec=pt,
        rmatmat=pt,
    ) 
    return H


def sparse_knn(D, k, mu):
    D1 = D.tocoo()
    idr = np.argsort(D1.row)
    D1.row[:] = D1.row[idr]
    D1.col[:] = D1.col[idr]
    D1.data[:] = D1.data[idr]

    _, ind = np.unique(D1.row, return_index=True)
    ind = np.append(ind, D1.data.size)
    for i in range(ind.size - 1):
        idx = np.argsort(D1.data[ind[i] : ind[i + 1]] - mu[D1.col[ind[i] : ind[i+1]]])
        if idx.size > k:
            idx = idx[:-k]
            D1.data[np.arange(ind[i], ind[i + 1])[idx]] = 0
    D1.eliminate_zeros()
    return D1

def mima(X1):
    x,y = X1.nonzero()
    data = X1.data
    mi = X1.min(0).A.flatten()
    ma = X1.max(0).A.flatten()
    X1.data[:] = (data - mi[y])/(ma[y]-mi[y])
    

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

def _callback_fn(res,ws,cfn,data,post_processing,tstart,pid):
    if post_processing is not None:
        res = post_processing(res)
    d = {"response": res,"cfn": cfn, "fail": False}
    d.update(data)
    ws.send(jsonify_numpy(d))

    global active_processes
    try:
        del active_processes[pid]
    except:
        pass

    print("Process count:",pid,"Time elsapsed:",time.time()-tstart,"seconds")

def _dummy():
    return True

def _multiprocessing_wrapper(da,ws,fn,cfn,data,post_processing,*args):
    global process_count
    process_count = process_count + 1    

    _new_callback_fn = partial(_callback_fn,ws=ws,cfn=cfn,data=data,post_processing=post_processing,tstart=time.time(),pid=process_count)
    _new_error_fn = partial(_error_callback,ws=ws, cfn=cfn, pid=process_count)
    
    global active_processes
    active_processes[process_count] = (fn,args,_new_callback_fn,_new_error_fn)

    try:
        if da._hosted_mode:
            da.pool.apply_async(_dummy).get(timeout=0.1)
        da.pool.apply_async(fn,args=args, callback=_new_callback_fn, error_callback=_new_error_fn)
    except TimeoutError:
        try:
            da.pool.apply_async(_dummy).get(timeout=1) 
            da.pool.apply_async(fn,args=args, callback=_new_callback_fn, error_callback=_new_error_fn)
        except TimeoutError:
            print("Resetting pool...")
            da._reset_pool()
            #for a in range(1,process_count+1):
            #    if a in active_processes:
            #        fn,args,_new_callback_fn,_new_error_fn = active_processes[a]
            #        da.pool.apply_async(fn,args=args, callback=_new_callback_fn, error_callback=_new_error_fn)            

def _error_callback(e, ws, cfn, pid):
    ws.send(jsonify_numpy({"fail": True, "cfn": cfn}))

    global active_processes
    try:
        del active_processes[pid]
    except:
        pass
    traceback.print_exception(type(e), e, e.__traceback__)

def sparse_scaler(X,scale=False, mode="OBS", mu=None, std=None):
    if scale:
        x,y = X.nonzero()
        if mode == "OBS":
            s = std[y]
            s[s==0]=1
            X.data[:] = (X.data - mu[y]) / s
            X.data[X.data>10]=10
        else:
            s = std[x]
            s[s==0]=1
            X.data[:] = (X.data - mu[x]) / s
            X.data[X.data>10]=10
        X.data[X.data<0]=0
        
def compute_diffexp_ttest(layer,tMean,tMeanSq,obs_mask_A,obs_mask_B,fname, multiplex, userID, scale, tMeanObs, tMeanSqObs):
    iA = np.where(obs_mask_A)[0]
    iB = np.where(obs_mask_B)[0]
    niA = np.where(np.invert(np.in1d(np.arange(obs_mask_A.size),iA)))[0]
    niB = np.where(np.invert(np.in1d(np.arange(obs_mask_A.size),iB)))[0]
    nA = iA.size
    nB = iB.size
    mode = userID.split("/")[-1].split("\\")[-1]
    CUTOFF = 35000
    mu = tMeanObs
    std = (tMeanSqObs**2 - mu**2)
    std[std<0]=0
    std=std**0.5

    if nA + nB == obs_mask_A.size:
        if nA < nB:
            if (nA < CUTOFF):
                XI = _read_shmem(shm,shm_csc,layer,format="csr",mode=mode)
                XS = XI[iA]
                sparse_scaler(XS,scale=scale,mode=mode,mu=mu,std=std)
                n = XI.shape[0]
                meanA,vA = sf.mean_variance_axis(XS,axis=0)
                meanAsq = vA-meanA**2
                meanAsq[meanAsq<0]=0
            else:
                XI = _read_shmem(shm, shm_csc, layer, format="csc", mode=mode)
                n = XI.shape[0]

                meanA,meanAsq = _partial_summer(XI.data,XI.indices,XI.indptr,XI.shape[1],iA,niA,
                                                mu=mu,std=std,mode=mode,scale=scale)
                meanA/=nA
                meanAsq/=nA
                vA = meanAsq - meanA**2
                vA[vA<0]=0
            
            meanB = (tMean*n - meanA*nA) / nB
            meanBsq = (tMeanSq*n - meanAsq*nA) / nB
            vB = meanBsq - meanB**2                 

        else:
            if (nB < CUTOFF):
                XI = _read_shmem(shm, shm_csc, layer, format="csr", mode=mode)
                XS = XI[iB]
                sparse_scaler(XS,scale=scale,mode=mode,mu=mu,std=std)
                n = XI.shape[0]
                meanB,vB = sf.mean_variance_axis(XS,axis=0)    
                meanBsq = vB-meanB**2
                meanBsq[meanBsq<0]=0                
            else:
                XI = _read_shmem(shm, shm_csc, layer, format="csc", mode=mode)
                n = XI.shape[0]

                meanB,meanBsq = _partial_summer(XI.data,XI.indices,XI.indptr,XI.shape[1],iB,niB,
                                                mu=mu,std=std,mode=mode,scale=scale)
                meanB/=nB
                meanBsq/=nB
                vB = meanBsq - meanB**2
                vB[vB<0]=0

            meanA = (tMean*n - meanB*nB) / nA
            meanAsq = (tMeanSq*n - meanBsq*nB) / nA
            vA = meanAsq - meanA**2                 
    else:
        if (nA < CUTOFF):
            XI = _read_shmem(shm, shm_csc, layer, format="csr", mode=mode)
            XS = XI[iA]
            sparse_scaler(XS,scale=scale,mode=mode,mu=mu,std=std)
            n = XI.shape[0]
            meanA,vA = sf.mean_variance_axis(XS,axis=0)    
        else:
            XI = _read_shmem(shm, shm_csc, layer, format="csc", mode=mode)
            n = XI.shape[0]

            meanA,meanAsq = _partial_summer(XI.data,XI.indices,XI.indptr,XI.shape[1],iA,niA,
                                            mu=mu,std=std,mode=mode,scale=scale)
            meanA/=nA
            meanAsq/=nA
            vA = meanAsq - meanA**2
            vA[vA<0]=0

        if (nB < CUTOFF):
            XI = _read_shmem(shm, shm_csc, layer, format="csr", mode=mode)
            XS = XI[iB]
            sparse_scaler(XS,scale=scale,mode=mode,mu=mu,std=std)
            n = XI.shape[0]
            meanB,vB = sf.mean_variance_axis(XS,axis=0)    
        else:
            XI = _read_shmem(shm, shm_csc, layer, format="csc", mode=mode)
            n = XI.shape[0]

            meanB,meanBsq = _partial_summer(XI.data,XI.indices,XI.indptr,XI.shape[1],iB,niB,
                                            mu=mu,std=std,mode=mode,scale=scale)
            meanB/=nB
            meanBsq/=nB
            vB = meanBsq - meanB**2
            vB[vB<0]=0            
    
    res = diffexp_generic.diffexp_ttest(meanA,vA,nA,meanB,vB,nB)
    fname2 = fname.split("_output.p")[0]+"_sg.p"
    if multiplex:
        pickle_dumper(res['positive'],fname)
        pickle_dumper(list(np.arange(150)),fname2)
    else:
        pickle_dumper(res['positive'],fname)
        pickle_dumper(res['negative'],fname.replace('Pop1 high','Pop2 high'))
        pickle_dumper(list(np.arange(150)),fname2)
        pickle_dumper(list(np.arange(150)),fname2.replace('Pop1 high','Pop2 high'))

    m = {}
    for k in res.keys():
        m[k] = res[k][:150]    
    return m

def pickle_loader(fn):
    with open(fn,"rb") as f:
        x = pickle.load(f)
    return x

def save_data(AnnDataDict,labelNames,cids,currentLayout,obs_mask,userID,ihm):
     #direc        

    fnames = glob(f"{userID}/emb/*.p")


    name = currentLayout.split(';')[-1]
  
    embs = {}
    nnms = {}
    params={}
    for f in fnames:
        n = f.split('/')[-1].split('\\')[-1][:-2]
        if name == n.split(';')[-1] or (';;' not in currentLayout and ';;' not in n):
            if exists(f) and exists(f"{userID}/nnm/{n}.p") and exists(f"{userID}/params/{n}.p"):
                embs[n] = pickle_loader(f)
                nnms[n] = pickle_loader(f"{userID}/nnm/{n}.p")
                params[n] = pickle_loader(f"{userID}/params/{n}.p")
            elif exists(f):
                embs[n] = pickle_loader(f)
    
    X = embs[currentLayout]
    f = np.isnan(X).sum(1)==0    
    filt = np.logical_and(f,obs_mask)

    mode = userID.split("/")[-1].split("\\")[-1]
    X = _read_shmem(shm,shm_csc,"X",format="csr",mode=mode)

    v = pickle_loader(f"{userID}/var/name_0.p")
    adata = AnnData(X = X[filt])
    adata.var_names = pd.Index(v)
    adata.obs_names = pd.Index(cids[filt])

    for k in AnnDataDict['varm'].keys():
        adata.varm[k] = AnnDataDict['varm'][k]


    if labelNames:
        for n in labelNames:
            l = pickle_loader(f"{userID}/obs/{n}.p")[filt]
            if n != "name_0":
                adata.obs[n] = pd.Categorical(l)        

    fnames = glob(f"{userID}/var/*.p")
    for f in fnames:
        n = f.split('/')[-1].split('\\')[-1][:-2]
        if ';;' in n:
            tlay = n.split(';;')[-1]
        else:
            tlay = ""

        if name == tlay:
            l = pickle_loader(f"{userID}/var/{n}.p")
            if n != "name_0":
                adata.var[n.split(';;')[0]] = pd.Series(data=l,index=v)              
    
    
    vkeys = list(adata.var.keys())
    for f in fnames:
        n = f.split('/')[-1].split('\\')[-1][:-2]
        if ';;' not in n:
            if n not in vkeys:
                l = pickle_loader(f"{userID}/var/{n}.p")
                if n != "name_0":
                    adata.var[n] = pd.Series(data=l,index=v)  


    fnames = glob(f"{userID}/pca/*.p")
    for f in fnames:
        n = f.split('/')[-1].split('\\')[-1][:-2]
        if ';;' in n:
            tlay = n.split(';;')[-1]
        else:
            tlay = ""

        if name == tlay:
            l = pickle_loader(f"{userID}/pca/{n}.p")[filt]
            adata.obsm[f"X_latent_{n.split(';;')[0]}"] = l
    
    
    vkeys = list(adata.obsm.keys())
    for f in fnames:
        n = f.split('/')[-1].split('\\')[-1][:-2]
        if ';;' not in n:
            if n not in vkeys:
                l = pickle_loader(f"{userID}/pca/{n}.p")[filt]
                adata.obsm[f"X_latent_{n}"] = l

    temp = {}
    for key in nnms.keys():
        temp[key] = nnms[key][filt][:,filt]
    for key in temp.keys():
        adata.obsp["N_"+key.split(';;')[-1]] = temp[key]
    for key in params.keys():
        adata.uns["N_"+key.split(';;')[-1]+"_params"]=params[key]
    for key in embs.keys():
        adata.obsm["X_"+key.split(';;')[-1]] = embs[key][filt] 
                
    for k in AnnDataDict["Xs"]:
        if k != "X":
            X = _read_shmem(shm,shm_csc,k,format="csr",mode=mode)
            adata.layers[k] = X[filt]

    adata.write_h5ad(f"{userID}/output/{currentLayout.replace(';','_')}.h5ad")
    return f"{userID}/output/{currentLayout.replace(';','_')}.h5ad"

def embed(adata,reembedParams, umap=True, kernelPca=False, nobatch=False):
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

    sam=None
    if not doSAM:
        if samHVG:
            try:
                adata = adata[:,np.sort(np.argsort(-np.array(list(adata.var['sam_weights'])))[:min(nTopGenesHVG,adata.shape[1])])]
            except:
                print("SAM weights not available, doing HVG selection...")
                try:
                    sc.pp.highly_variable_genes(adata,flavor='seurat_v3',n_top_genes=min(nTopGenesHVG,adata.shape[1]), n_bins=nBinsHVG)                
                    adata = adata[:,adata.var['highly_variable']]                
                except:
                    print('Error during HVG selection - some of your expressions are probably negative.')                
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
        vn = np.array(list(adata.var_names))
    else:            
        sam=SAM(counts = adata, inplace=True)
        X = sam.adata.X
        preprocessing = "StandardScaler" if scaleData else "Normalizer"
        bk=batchKey if batchMethod == "Harmony" else None
        sam.run(batch_key=bk,n_genes=nTopGenesHVG,projection=None,npcs=min(min(adata.shape) - 1, numPCs), weight_mode=weightModeSAM,preprocessing=preprocessing,distance=distanceMetric,num_norm_avg=nnaSAM,max_iter=5)
        sam.adata.X = X        
        adata=sam.adata
        vn = np.array(list(adata.var_names[np.sort(np.argsort(-np.array(list(adata.var['weights']))))]))

    if doBatch and not nobatch:
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

    if not doSAM or (doSAM and batchMethod == "BBKNN" and not nobatch):
        if not doBatch or doBatch and batchMethod != "BBKNN":
            sc.pp.neighbors(adata, n_neighbors=neighborsKnn, use_rep="X_pca",method=neighborsMethod, metric=distanceMetric) 
        
        if kernelPca:
            Z = kernel_svd(adata.obsp['connectivities'].dot(adata.obsp['connectivities'].T),min(min(adata.shape) - 1, numPCs))
            adata.obsm['X_umap'] = SAM().run_umap(X=Z,min_dist=umapMinDist,metric=distanceMetric,seed=0)[0]  
            adata.obsp['connectivities'] = ut.calc_nnm(Z,neighborsKnn,distanceMetric)
            adata.obsp['connectivities'].data[:]=1                      
        elif umap:   
            sc.tl.umap(adata, min_dist=umapMinDist,maxiter = 500 if adata.shape[0] <= 10000 else 200)
    else:
        if kernelPca:
            Z = kernel_svd(sam.adata.obsp['connectivities'].dot(sam.adata.obsp['connectivities'].T),min(min(adata.shape) - 1, numPCs))
            sam.adata.obsm['X_umap'] = sam.run_umap(X=Z,min_dist=umapMinDist,metric=distanceMetric,seed=0)[0]         
            adata.obsm['X_umap'] = sam.adata.obsm['X_umap']
            adata.obsp['connectivities'] = ut.calc_nnm(Z,neighborsKnn,distanceMetric)
            adata.obsp['connectivities'].data[:]=1
        elif umap:
            sam.run_umap(metric=distanceMetric,min_dist=umapMinDist)
            adata.obsm['X_umap'] = sam.adata.obsm['X_umap']
        adata.obsp['connectivities'] = sam.adata.obsp['connectivities']
    if umap:
        u = adata.obsm["X_umap"]        
    
    nnm = adata.obsp['connectivities']
    obsm = adata.obsm['X_pca']

    if umap:
        return nnm,obsm,u,sam, vn
    else:
        return nnm,obsm,sam, vn

def compute_embedding(AnnDataDict, reembedParams, parentName, embName, currentLayout, userID, ihm):
    mode = userID.split("/")[-1].split("\\")[-1]
    ID = userID.split("/")[0].split("\\")[0]
    
    obs_mask = AnnDataDict['obs_mask']
    obs_mask2 = AnnDataDict['obs_mask2']    


    embeddingMode = reembedParams.get("embeddingMode","Preprocess and run")
    otherMode = "OBS" if mode == "VAR" else "VAR"
    otherID = ID +"/" + otherMode
    X_full = None
    if embName == "":
        embName = f"umap_{str(hex(int(time.time())))[2:]}"

    if not np.all(obs_mask):
        name = f"{parentName};;{embName}"
    else:
        name = embName 
    
    if exists(f"{userID}/emb/{name}.p"):
        name = f"{name}_{str(hex(int(time.time())))[2:]}"
    paired_embeddings = pickle_loader(f"{ID}/paired_embeddings.p")
    
    pairedMode = currentLayout in paired_embeddings
    
    if currentLayout not in paired_embeddings:
        obs_mask2[:] = True

    if embeddingMode == "Cell and gene embedding":
        if pairedMode:
            if not np.all(obs_mask):
                name2 = f"{paired_embeddings[parentName]};;{embName}"
            else:
                name2 = embName    
        else:
            name2 = name

        if exists(f"{ID}/{otherMode}/emb/{name2}.p"):
            name2 = f"{name2}_{str(hex(int(time.time())))[2:]}"


        paired_embeddings[name] = name2
        paired_embeddings[name2]= name

        pickle_dumper(paired_embeddings,f"{ID}/paired_embeddings.p")
        
        dsampleKey = reembedParams.get("dsampleKey","None")
        if mode == "VAR": #if mode is #VAR, obs_mask2 is for cells
            if dsampleKey!="None" and obs_mask2.sum() > 50000:
                cl = np.array(list(AnnDataDict['var'][dsampleKey]))[obs_mask2]
                clu,cluc = np.unique(cl,return_counts=True)
                cluc2 = cluc/cluc.sum()
                for c,cc,ccf in zip(clu,cluc,cluc2):
                    sub = np.where(cl==c)[0]
                    filt[np.random.choice(sub,size=max(min(int(ccf*50000),cc),min(cc,10)),replace=False)] = True
                temp = obs_mask2.copy()
                obs_mask2[:] = False
                obs_mask2[temp] = filt
            elif obs_mask2.sum() > 50000:
                # random sampling
                filt = np.random.choice(np.where(obs_mask2)[0],size=50000,replace=False)
                obs_mask2[:] = False
                obs_mask2[filt] = True

            AnnDataDict2 = {"Xs": AnnDataDict['Xs'],"obs": AnnDataDict['var'], "var": AnnDataDict['obs'], "obs_mask": obs_mask2, "obs_mask2": obs_mask}
            adata = compute_preprocess(AnnDataDict2, reembedParams, userID, "OBS", other=True) #subset cells
            adata = adata[:,obs_mask] # subset genes
            
            X_full = adata.X.T #sg x sc
        elif mode == "OBS": #obs_mask2 is for genes
            adata = compute_preprocess(AnnDataDict, reembedParams, userID, "OBS")
            X_full = adata.X # sc x sg
        
        nnm1, pca1, sam1, vn1 = embed(adata,reembedParams, umap=False, nobatch=mode=="VAR")
        vn1 = vn1.astype('int')
        adata.X.eliminate_zeros()
        _,y1 = adata.X.nonzero()
        y1=y1[adata.X.data>min(reembedParams.get("minCountsGF",0),3)]
        a1,c1 = np.unique(y1,return_counts=True)
        n1 = np.zeros(adata.shape[1])
        n1[a1]=c1                
        n1 = n1 >= min(20,max(5,reembedParams.get("minCellsGF",0)/100*adata.shape[0]))
        vn2 = np.array(list(adata.var_names))[n1].astype('int')
        jointHVG = reembedParams.get("jointHVG",True) and  mode == "OBS"
        
        if not jointHVG:
            vn1 = np.array(list(adata.var_names)).astype('int')
        
        vn1 = vn1[np.in1d(vn1,vn2)]        
        obs_mask2[:]=False
        obs_mask2[vn1]=True
        adata = adata[:,vn1.astype('str')]
        adata2 = adata.X.T

        cl=SAM().leiden_clustering(X=nnm1,res=5)
        clu = np.unique(cl)
        avgs = []
        for c in clu:                
            avgs.append(adata.X[cl==c].mean(0).A.flatten()) #do soft-averaging with coclustering matrix instead, perhaps
        avgs = np.array(avgs)
        pca_obj = PCA(n_components = None)
        pca_obj.fit(avgs)
        pca2 = pca_obj.components_.T*pca_obj.explained_variance_**0.5
        nnm2 = ut.calc_nnm(pca2,reembedParams.get("neighborsKnn",20),reembedParams.get("distanceMetric",'correlation'))
        nnm2.data[:] = 1
        if reembedParams.get("kernelPca",False):
            pca1 = kernel_svd(nnm1,reembedParams.get("numPCs",50))
            nnm1 = ut.calc_nnm(pca1,reembedParams.get("neighborsKnn",20),reembedParams.get("distanceMetric",'correlation'))
            nnm1.data[:]=1    

            pca2 = kernel_svd(nnm2,reembedParams.get("numPCs",50))
            nnm2 = ut.calc_nnm(pca2,reembedParams.get("neighborsKnn",20),reembedParams.get("distanceMetric",'correlation'))
            nnm2.data[:]=1    
        
        # given nnm1, pca1, sam1, nnm2, pca2

        X1 = StandardScaler(with_mean=False).fit_transform(adata.X) # cells
        X2 = StandardScaler(with_mean=False).fit_transform(adata2)
        mu1 = X1.mean(0).A.flatten()
        mu2 = X2.mean(0).A.flatten()        
        KNN1v2 = sparse_knn(X1,40,mu1).tocsr()
        KNN2v1 = sparse_knn(X2,40,mu2).tocsr()
        KNN1v2.data[:]=1
        KNN2v1.data[:]=1
        X1 = X1.multiply(KNN1v2).tocsr()
        X2 = X2.multiply(KNN2v1).tocsr()
        mima(X1)
        mima(X2)        
        
        X = sp.sparse.bmat([[nnm1,X1],[X2,nnm2]]).tocsr()
        print("Running Kernel PCA...")
        Z = kernel_svd(X,k=pca1.shape[1])        

        pca1 = Z[:nnm1.shape[0]]
        pca2 = Z[nnm1.shape[0]:]

        umapMinDist = reembedParams.get("umapMinDist",0.1)
        neighborsKnn = reembedParams.get("neighborsKnn",20)
        distanceMetric = reembedParams.get("distanceMetric","cosine")
        print("Running UMAP...")
        X_umap = SAM().run_umap(X=Z,metric=distanceMetric,seed = 0,min_dist=umapMinDist)[0]
        X_umap = DataAdaptor.normalize_embedding(X_umap)

        print("Calculating new graphs from kPCA...")
        nnm1 = ut.calc_nnm(pca1,neighborsKnn,"cosine")
        nnm2 = ut.calc_nnm(pca2,neighborsKnn,"cosine")
        nnm1.data[:] = 1-nnm1.data
        nnm1.data[nnm1.data<0.05]=0.05
        nnm2.data[:] = 1-nnm2.data
        nnm2.data[nnm2.data<0.05]=0.05

        X_umap1 = X_umap[:nnm1.shape[0]]
        X_umap2 = X_umap[nnm1.shape[0]:]
        
        fns_=glob(f"{otherID}/emb/*.p") #delete empty root embedding if it's the only one there in other mode
        if len(fns_) > 0:
            if len(fns_) == 1 and "root.p" in fns_[0]:
                os.remove(fns_[0])        
        
        if mode == "OBS":
            X_umap = np.full((obs_mask.shape[0], X_umap1.shape[1]), np.NaN)
            X_umap[obs_mask] = X_umap1

            pca = np.full((obs_mask.shape[0], pca1.shape[1]), np.NaN)
            pca[obs_mask] = pca1   
            sam=sam1 
            nnm = nnm1

            ID = userID.split('/')[0].split('\\')[0]+'/VAR'
            Xu2 = np.full((obs_mask2.shape[0], X_umap2.shape[1]), np.NaN)
            Xu2[obs_mask2] = X_umap2
            pc2 = np.full((obs_mask2.shape[0], pca2.shape[1]), np.NaN)
            pc2[obs_mask2] = pca2   
            IXer = pd.Series(index =np.arange(nnm2.shape[0]), data = np.where(obs_mask2.flatten())[0])
            x,y = nnm2.nonzero()
            d = nnm2.data
            nnm2 = sp.sparse.coo_matrix((d,(IXer[x].values,IXer[y].values)),shape=(obs_mask2.size,)*2).tocsr()
            pickle_dumper(nnm2, f"{ID}/nnm/{name2}.p") 
            pickle_dumper(Xu2, f"{ID}/emb/{name2}.p")
            pickle_dumper(pc2, f"{ID}/pca/pca;;{name2}.p")

        else:
            X_umap = np.full((obs_mask.shape[0], X_umap2.shape[1]), np.NaN)
            X_umap[obs_mask] = X_umap2

            pca = np.full((obs_mask.shape[0], pca2.shape[1]), np.NaN)
            pca[obs_mask] = pca2 
            sam=None
            nnm = nnm2

            ID = userID.split('/')[0].split('\\')[0]+'/OBS'
            
            Xu1 = np.full((obs_mask2.shape[0], X_umap1.shape[1]), np.NaN)
            Xu1[obs_mask2] = X_umap1
            pc1 = np.full((obs_mask2.shape[0], pca1.shape[1]), np.NaN)
            pc1[obs_mask2] = pca1   
            IXer = pd.Series(index =np.arange(nnm1.shape[0]), data = np.where(obs_mask2.flatten())[0])
            x,y = nnm1.nonzero()
            d = nnm1.data
            nnm1 = sp.sparse.coo_matrix((d,(IXer[x].values,IXer[y].values)),shape=(obs_mask2.size,)*2).tocsr()            
            pickle_dumper(nnm1, f"{ID}/nnm/{name2}.p") 
            pickle_dumper(Xu1, f"{ID}/emb/{name2}.p")
            pickle_dumper(pc1, f"{ID}/pca/pca;;{name2}.p")

    elif embeddingMode == "Preprocess and run":
        dsampleKey = reembedParams.get("dsampleKey","None")
        if mode == "VAR":
            if dsampleKey!="None" and obs_mask2.sum() > 50000:
                cl = np.array(list(AnnDataDict['var'][dsampleKey]))[obs_mask2]
                clu,cluc = np.unique(cl,return_counts=True)
                cluc2 = cluc/cluc.sum()
                for c,cc,ccf in zip(clu,cluc,cluc2):
                    sub = np.where(cl==c)[0]
                    filt[np.random.choice(sub,size=max(min(int(ccf*50000),cc),min(cc,10)),replace=False)] = True
                temp = obs_mask2.copy()
                obs_mask2[:] = False
                obs_mask2[temp] = filt
            elif obs_mask2.sum() > 50000:
                # random sampling
                filt = np.random.choice(np.where(obs_mask2)[0],size=50000,replace=False)
                obs_mask2[:] = False
                obs_mask2[filt] = True

            AnnDataDict2 = {"Xs": AnnDataDict['Xs'],"obs": AnnDataDict['var'], "var": AnnDataDict['obs'], "obs_mask": obs_mask2}
            adata = compute_preprocess(AnnDataDict2, reembedParams, userID, "OBS", other=True) #cells
            adata = adata[:,obs_mask]
            nnm, pca, _, _ = embed(adata,reembedParams, umap=False, nobatch=True)

            cl=SAM().leiden_clustering(X=nnm,res=10)
            clu = np.unique(cl)
            avgs = []
            for c in clu:                
                avgs.append(adata.X[cl==c].mean(0).A.flatten()) #do soft-averaging with coclustering matrix instead, perhaps
            avgs = np.array(avgs)
            pca_obj = PCA(n_components = None)
            pca_obj.fit(avgs)
            obsm = pca_obj.components_.T*pca_obj.explained_variance_**0.5
            nnm = ut.calc_nnm(obsm,reembedParams.get("neighborsKnn",20),reembedParams.get("distanceMetric",'correlation'))
            nnm.data[:] = 1
            if reembedParams.get("kernelPca",False):
                print("Running kernel PCA...")
                Z = kernel_svd(nnm,reembedParams.get("numPCs",50))
                nnm = ut.calc_nnm(Z,reembedParams.get("neighborsKnn",20),reembedParams.get("distanceMetric",'correlation'))
                nnm.data[:]=1    
            else:              
                Z = obsm
            umap = SAM().run_umap(X=Z,min_dist=reembedParams.get("umapMinDist",0.1),metric=reembedParams.get("distanceMetric",'correlation'),seed=0)[0]  

            adata = compute_preprocess(AnnDataDict, reembedParams, userID, "VAR") #genes
            X_full = adata.X

            result = np.full((obs_mask.shape[0], umap.shape[1]), np.NaN)
            result[obs_mask] = umap
            X_umap = result
            pca = np.full((obs_mask.shape[0], obsm.shape[1]), np.NaN)
            pca[obs_mask] = obsm              
        else:
            adata = compute_preprocess(AnnDataDict, reembedParams, userID, mode)
            X_full = adata.X
            nnm, obsm, umap, sam, _ = embed(adata,reembedParams,umap=True, kernelPca = reembedParams.get("kernelPca",False))
            
            result = np.full((obs_mask.shape[0], umap.shape[1]), np.NaN)
            result[obs_mask] = umap
            X_umap = result
            pca = np.full((obs_mask.shape[0], obsm.shape[1]), np.NaN)
            pca[obs_mask] = obsm    
        X_umap = DataAdaptor.normalize_embedding(X_umap)

    elif embeddingMode == "Create embedding from subset":
         #direc    
        if pairedMode:
            ID = userID.split("/")[0].split("\\")[0]

            if not np.all(obs_mask):
                name2 = f"{paired_embeddings[parentName]};;{embName}"
            else:
                name2 = embName    

            if exists(f"{ID}/{otherMode}/emb/{name2}.p"):
                name2 = f"{name2}_{str(hex(int(time.time())))[2:]}"

            paired_embeddings[name] = name2
            paired_embeddings[name2]= name
            pickle_dumper(paired_embeddings,f"{ID}/paired_embeddings.p")

            #otherMode
            cL = paired_embeddings[currentLayout]
            umap = pickle_loader(f"{ID}/{otherMode}/emb/{cL}.p")                     
            result = np.full((obs_mask2.shape[0], umap.shape[1]), np.NaN)
            result[obs_mask2] = umap[obs_mask2] 
            X_umap = result  

            try:
                nnm = pickle_loader(f"{ID}/{otherMode}/nnm/{cL}.p")
            except:
                nnm = None

            try:
                obsm = pickle_loader(f"{ID}/{otherMode}/pca/pca;;{cL}.p")
            except:
                try:
                    obsm = pickle_loader(f"{ID}/{otherMode}/pca/pca.p")
                except:
                    obsm = None
            if obsm is None:
                pca = obsm
            else:
                pca = np.full((obs_mask2.shape[0], obsm.shape[1]), np.NaN)
                pca[obs_mask2] = obsm[obs_mask2]  
            
            if nnm is not None:
                pickle_dumper(nnm, f"{ID}/{otherMode}/nnm/{name2}.p") 
            if pca is not None:
                pickle_dumper(pca, f"{ID}/{otherMode}/pca/pca;;{name2}.p") 

            Xu2 = X_umap            
            umap = pickle_loader(f"{userID}/emb/{currentLayout}.p")                     
            result = np.full((obs_mask.shape[0], umap.shape[1]), np.NaN)
            result[obs_mask] = umap[obs_mask] 
            X_umap = result 

            x = DataAdaptor.normalize_embedding(np.vstack((Xu2,X_umap)))
            Xu2 = x[:Xu2.shape[0]]
            pickle_dumper(Xu2, f"{ID}/{otherMode}/emb/{name2}.p")                                               

            X_umap = x[Xu2.shape[0]:]
        else:
            umap = pickle_loader(f"{userID}/emb/{currentLayout}.p")                     
            result = np.full((obs_mask.shape[0], umap.shape[1]), np.NaN)
            result[obs_mask] = umap[obs_mask] 
            X_umap = result  

        try:
            nnm = pickle_loader(f"{userID}/nnm/{currentLayout}.p")[obs_mask][:,obs_mask]
        except:
            nnm = None

        try:
            obsm = pickle_loader(f"{userID}/pca/pca;;{currentLayout}.p")
        except:
            try:
                obsm = pickle_loader(f"{userID}/pca/pca.p")
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
            
         #direc 

        try:
            obsm = pickle_loader(f"{userID}/pca/{latentSpace};;{currentLayout}.p")   
        except:
            obsm = pickle_loader(f"{userID}/pca/{latentSpace}.p")   

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
        X_umap = DataAdaptor.normalize_embedding(X_umap)
        

    dims = [f"{name}_0", f"{name}_1"]
    layout_schema = {"name": name, "type": "float32", "dims": dims}
    if nnm is not None:
        nnm_sub = nnm.copy()

        IXer = pd.Series(index =np.arange(nnm.shape[0]), data = np.where(obs_mask.flatten())[0])
        x,y = nnm.nonzero()
        d = nnm.data
        nnm = sp.sparse.coo_matrix((d,(IXer[x].values,IXer[y].values)),shape=(obs_mask.size,)*2).tocsr()

     #direc        
    if exists(f"{userID}/params/latest.p"):
        latestPreParams = pickle_loader(f"{userID}/params/latest.p")
    else:
        latestPreParams = None

    if exists(f"{userID}/params/{parentName}.p"):
        parentParams = pickle_loader(f"{userID}/params/{parentName}.p")
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
        X_full = _read_shmem(shm,shm_csc,dataLayer,format="csr",mode=mode)[obs_mask]
    
    if nnm is not None:
        if reembedParams.get("calculateSamWeights",False) and not reembedParams.get("doSAM",False):
            var = dispersion_ranking_NN(X_full,nnm_sub)
            for k in var.keys():
                x = var[k]
                y = np.zeros(obs_mask2.size,dtype=x.dtype)
                y[obs_mask2]=x
                var[k] = y

            for k in var.keys():
                fn = "{}/var/{};;{}.p".format(userID,k.replace('/','_'),name)
                fn2 = "{}/obs/{};;{}.p".format(otherID,k.replace('/','_'),name)
                if not os.path.exists(fn.split(';;')[0]+'.p'):
                    pickle_dumper(np.array(list(var[k])).astype('float'),fn.split(';;')[0]+'.p')
                    pickle_dumper(np.array(list(var[k])).astype('float'),fn2.split(';;')[0]+'.p')
                pickle_dumper(np.array(list(var[k])).astype('float'),fn)
                pickle_dumper(np.array(list(var[k])).astype('float'),fn2)
        elif reembedParams.get("doSAM",False) and sam is not None:
            keys = ['weights','spatial_dispersions']
            for k in keys:
                x = sam.adata.var[k]
                y = np.zeros(obs_mask2.size,dtype=x.dtype)
                y[obs_mask2]=x
                sam.adata.var[k] = y
                            
            for k in keys:                
                fn = "{}/var/{};;{}.p".format(userID,"sam_"+k.replace('/','_'),name)
                fn2 = "{}/obs/{};;{}.p".format(otherID,k.replace('/','_'),name)
                if not os.path.exists(fn.split(';;')[0]+'.p'):
                    pickle_dumper(np.array(list(sam.adata.var[k])).astype('float'),fn.split(';;')[0]+'.p')
                    pickle_dumper(np.array(list(sam.adata.var[k])).astype('float'),fn2.split(';;')[0]+'.p')
                pickle_dumper(np.array(list(sam.adata.var[k])).astype('float'),fn)  
                pickle_dumper(np.array(list(sam.adata.var[k])).astype('float'),fn2)            
        pickle_dumper(nnm, f"{userID}/nnm/{name}.p")
    
    pickle_dumper(X_umap, f"{userID}/emb/{name}.p")
    pickle_dumper(reembedParams, f"{userID}/params/{name}.p")
    if pca is not None:
        pickle_dumper(pca, f"{userID}/pca/pca;;{name}.p")

    return layout_schema

def pickle_dumper(x,fn):
    with open(fn,"wb") as f:
        pickle.dump(x,f)

def compute_leiden(obs_mask,name,resolution,userID):
     #direc 
    try:
        nnm = pickle_loader(f"{userID}/nnm/{name}.p")   
        nnm = nnm[obs_mask][:,obs_mask]         
    except:
        emb = pickle_loader(f"{userID}/emb/{name}.p")            
        emb = emb[obs_mask]
        nnm = ut.calc_nnm(emb,20,'euclidean')
        nnm.data[:]=1
        if np.all(obs_mask):
            pickle_dumper(nnm, f"{userID}/nnm/{name}.p") 

    X = nnm

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
    
    try:
        nnm = pickle_loader(f"{userID}/nnm/{name}.p")   
        nnm = nnm[obs_mask][:,obs_mask]         
    except:
        emb = pickle_loader(f"{userID}/emb/{name}.p")            
        emb = emb[obs_mask]
        nnm = ut.calc_nnm(emb,20,'euclidean')
        nnm.data[:]=1
        if np.all(obs_mask):
            pickle_dumper(nnm, f"{userID}/nnm/{name}.p") 

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

def compute_sankey_df_corr(labels, obs_mask, params, var, userID):    
    mode = userID.split("/")[-1].split("\\")[-1]
    adata = AnnData(X=_read_shmem(shm,shm_csc,params["dataLayer"],format="csr",mode=mode)[obs_mask],var=var)

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

def compute_sankey_df_corr_sg(labels, obs_mask, params, var, userID):
    mode = userID.split("/")[-1].split("\\")[-1]
    adata = AnnData(X=_read_shmem(shm,shm_csc,params["dataLayer"],format="csr",mode=mode)[obs_mask])    
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

def compute_preprocess(AnnDataDict, reembedParams, userID, mode, other=True):
    layers = AnnDataDict['Xs'] 
    obs = AnnDataDict['obs']
    var = AnnDataDict['var']
    obs_mask = AnnDataDict['obs_mask']
    obs_mask2 = AnnDataDict['obs_mask2']
    kkk=layers[0]
    if np.all(obs_mask2):
        X = _read_shmem(shm,shm_csc,kkk,format="csr",mode=mode)[obs_mask]
    else:
        X = _read_shmem(shm,shm_csc,kkk,format="csr",mode=mode)[obs_mask][:,obs_mask2]
    
    adata = AnnData(X=X,obs=obs[obs_mask],var=var[obs_mask2])
    adata.layers[layers[0]] = X
    for k in layers[1:]:
        kkk=k
        if np.all(obs_mask2):
            X = _read_shmem(shm,shm_csc,kkk,format="csr",mode=mode)[obs_mask]
        else:
            X = _read_shmem(shm,shm_csc,kkk,format="csr",mode=mode)[obs_mask][:,obs_mask2]
        adata.layers[k] = X


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
    if not other and doBatchPrep and batchPrepKey != "" and batchPrepLabel != "":
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
                ixx = np.where(obs_mask2)[0]
                obs_mask2[:]=False
                obs_mask2[ixx[a]] = True  
                
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
        ixx = np.where(obs_mask)[0]
        obs_mask[:]=False
        obs_mask[ixx[filt]]=True          
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
            ixx = np.where(obs_mask2)[0]
            obs_mask2[:]=False
            obs_mask2[ixx[a]] = True  
            ixx = np.where(obs_mask)[0]
            obs_mask[:]=False
            obs_mask[ixx[filt]]=True          
            
            adata_raw.X = adata_raw.X.multiply(a.flatten()[None,:]).tocsr()
            
            if sumNormalizeCells:
                sc.pp.normalize_total(adata_raw,target_sum=target_sum)
            if logTransform:
                try:
                    sc.pp.log1p(adata_raw) 
                except:
                    pass
        
     #direc #FINDME
    #if mode == "VAR":   
    #    adata_raw.X = StandardScaler(with_mean=False).fit_transform(adata_raw.X.T).T
    #    adata_raw.X.data[adata_raw.X.data>10]=10   

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
    ID = userID.split('/')[0].split('\\')[0]
    pickle_dumper(prepParams, f"{ID}/OBS/params/latest.p")
    pickle_dumper(prepParams, f"{ID}/VAR/params/latest.p")
    return adata_raw[filt]
   


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
                scale = data.get("scale",False)
                shape = da.get_shape()

                obs_mask_A = da._axis_filter_to_mask(Axis.OBS, obsFilterA["obs"], shape[0])
                obs_mask_B = da._axis_filter_to_mask(Axis.OBS, obsFilterB["obs"], shape[0])      
                
                annotations = da.dataset_config.user_annotations        
                 #direc                       
                userID = f"{annotations._get_userdata_idhash(da)}"  
                mode = userID.split('/')[-1].split('\\')[-1]
                
                tMean = da.tMeans[mode][layer]
                tMeanSq = da.tMeanSqs[mode][layer]
                tMeanObs = da.tMeans["OBS"][layer]
                tMeanSqObs = da.tMeanSqs["OBS"][layer]                
                
                fnn=data['groupName'].replace('/','_')
                fnn2 = None
                if not os.path.exists(f"{userID}/diff/{fnn}"):
                    os.makedirs(f"{userID}/diff/{fnn}")
                if not data.get('multiplex',None):
                    pickle_dumper(np.where(obs_mask_A)[0],f"{userID}/diff/{fnn}/Pop1 high.p")
                    pickle_dumper(np.where(obs_mask_B)[0],f"{userID}/diff/{fnn}/Pop2 high.p")
                else:
                    fnn2=str(data['category']).replace('/','_')                                    
                    pickle_dumper(np.where(obs_mask_A)[0],f"{userID}/diff/{fnn}/{fnn2}.p")

                if fnn2 is None:
                    fnn2 = "Pop1 high"                
                fname = f"{userID}/diff/{fnn}/{fnn2}_output.p"
                _multiprocessing_wrapper(da,ws,compute_diffexp_ttest, "diffexp",data,None,layer,tMean,tMeanSq,obs_mask_A,obs_mask_B,fname, data.get('multiplex',None), userID, scale, tMeanObs, tMeanSqObs)
    
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
                    otherSelector = data["otherSelector"]
        
                    annotations = da.dataset_config.user_annotations        
                    userID = f"{annotations._get_userdata_idhash(da)}"  
                    layers = []
                    batchKey = reembedParams.get("batchKey","")
                    doBatchPrep = reembedParams.get("doBatchPrep",False)
                    batchPrepParams = reembedParams.get("batchPrepParams",{})
                    batchPrepKey = reembedParams.get("batchPrepKey","")
                    batchPrepLabel = reembedParams.get("batchPrepLabel","")
                    dataLayer = reembedParams.get("dataLayer","X")
                    OBS_KEYS = ["name_0","sam_weights"]
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
                     #direc  

                    obs = pd.DataFrame()
                    for k in OBS_KEYS:
                        try:
                            obs[k] = pickle_loader(f"{userID}/obs/{k}.p")
                        except:
                            pass
                    obs.index = pd.Index(np.arange(obs.shape[0]))
                                        
                    fnames = glob(f"{userID}/var/*.p")
                    v = pickle_loader(f"{userID}/var/name_0.p")
                    var = pd.DataFrame(data=v[:,None],index=v,columns=["name_0"])
                    for f in fnames:
                        n = f.split('/')[-1].split('\\')[-1][:-2]
                        if ';;' in n:
                            tlay = n.split(';;')[-1]
                        else:
                            tlay = parentName

                        if parentName == tlay:
                            l = pickle_loader(f"{userID}/var/{n}.p")
                            if n != "name_0":
                                var[n] = l
                    var.index = pd.Index(np.arange(var.shape[0]))
                    obs_mask2 = np.zeros(var.shape[0],dtype='bool')
                    if len(otherSelector)==0:
                        obs_mask2[:]=True
                    else:
                        obs_mask2[otherSelector] = True
                    AnnDataDict = {
                        "Xs": layers,
                        "obs": obs,
                        "var": var,
                        "obs_mask": da._axis_filter_to_mask(Axis.OBS, filter["obs"], obs.shape[0]),
                        "obs_mask2": obs_mask2
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
                params = data.get("params",{"samHVG": False,"numGenes": 3000, "sankeyMethod": "Graph alignment", "selectedGenes": [], "dataLayer": "X", "numEdges": 5})
                annotations = da.dataset_config.user_annotations        
                userID = f"{annotations._get_userdata_idhash(da)}"  
               
                 #direc   
                fnames = glob(f"{userID}/var/*.p")
                v = pickle_loader(f"{userID}/var/name_0.p")
                var = pd.DataFrame(data=v[:,None],index=v,columns=["name_0"])
                for f in fnames:
                    n = f.split('/')[-1].split('\\')[-1][:-2]
                    if ';;' in n:
                        tlay = n.split(';;')[-1]
                    else:
                        tlay = name

                    if name == tlay:
                        l = pickle_loader(f"{userID}/var/{n}.p")
                        if n != "name_0":
                            var[n] = l
                del var['name_0']
                                                              
                obs_mask = da._axis_filter_to_mask(Axis.OBS, filter["obs"], da.get_shape()[0])
                if params["sankeyMethod"] == "Graph alignment":
                    _multiprocessing_wrapper(da,ws,compute_sankey_df, "sankey",data,None,labels, name, obs_mask, userID, params['numEdges'])              
                elif params["sankeyMethod"] == "Correlation":
                    _multiprocessing_wrapper(da,ws,compute_sankey_df_corr, "sankey",data,None,labels, obs_mask, params, var, userID)
                elif params["sankeyMethod"] == "Correlation (selected genes)":
                    _multiprocessing_wrapper(da,ws,compute_sankey_df_corr_sg, "sankey",data,None,labels, obs_mask, params,pd.Series(index=v,data=np.arange(var.shape[0])), userID)
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
                name_0 = pickle_loader(f"{userID}/obs/name_0.p")
                _multiprocessing_wrapper(da,ws,save_data, "downloadAnndata",data,None,AnnDataDict,labelNames,name_0,currentLayout,obs_mask,userID, current_app.hosted_mode)

 
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
def _partial_summer(d,x,ptr,m,inc,ninc, calculate_sq=True, mu=np.array([]), std=np.array([]), mode="OBS", scale=False):
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
            ps = di[j] if htable[xi[j]] else 0
            if scale:                    
                if mode == "OBS":
                    if std[i] <= 0:
                        denom = 1
                    else:
                        denom = std[i]
                    ps = max(min((ps - mu[i])/denom,10),0)
                else:
                    if std[xi[j]] <= 0:
                        denom = 1
                    else:
                        denom = std[xi[j]]                    
                    ps = max(min((ps - mu[xi[j]])/denom,10),0)

            s += ps
            if calculate_sq:
                ps2 = ps**2 if htable[xi[j]] else 0
                s2 += ps2
                
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


def _read_shmem(shm,shm_csc,layer,format="csr",mode="OBS"):
    if mode == "OBS":
        if format == "csr":
            return _create_data_from_shm(*shm[layer])
        else:
            return _create_data_from_shm_csc(*shm_csc[layer])
    else:
        if format == "csr":
            return _create_data_from_shm_csc(*shm_csc[layer]).T
        else:
            return _create_data_from_shm(*shm[layer]).T        

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
        self._hosted_mode = app_config.hosted_mode
        self._joint_mode = app_config.joint_mode
        self._load_data(data_locator, root_embedding=app_config.root_embedding, sam_weights=app_config.sam_weights, preprocess=app_config.preprocess)    
        self._create_pool()

        print("Validating and initializing...")
        self._validate_and_initialize()

        """print("Stabilizing multiprocessor...")
        loop=True
        while loop:
            try:
                self.pool.apply_async(_dummy).get(timeout=0.1)
                loop=False
            except TimeoutError:
                pass"""

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

    def _load_data(self, data_locator, preprocess=False, sam_weights=False, root_embedding = None):
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
                #target_sum = np.median(np.array(adata.X.sum(1)).flatten())
                adata.layers['raw_counts'] = adata.X.copy()
                #sc.pp.normalize_total(adata,target_sum=target_sum)                
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
            
            _,yi = adata.X.nonzero()
            yia,yic = np.unique(yi,return_counts=True)
            yics = np.zeros(adata.shape[1])
            yics[yia] = yic
            adata = adata[:,yics>=10].copy()

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

            if 'connectivities' in adata.obsp.keys() and sam_weights:
                print('Found connectivities adjacency matrix. Computing SAM gene weights...')
                var = dispersion_ranking_NN(adata.X,adata.obsp['connectivities'])
                for k in var.keys():
                    adata.var[k]=var[k]

            print("Loading and precomputing layers necessary for fast differential expression and reembedding...")
            self.tMeans = {"OBS": {}, "VAR": {}}
            self.tMeanSqs = {"OBS": {}, "VAR": {}}
            
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
                self.tMeans["OBS"][k] = mean
                self.tMeanSqs["OBS"][k] = meansq
                adata.var['mean'] = mean
                adata.var['variance'] = v

                mean,v = sf.mean_variance_axis(adata.layers[k],axis=1)
                meansq = v-mean**2
                self.tMeans["VAR"][k] = mean
                self.tMeanSqs["VAR"][k] = meansq                

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
            
            self.NAME = {"OBS": {"obs": np.array(list(adata.obs_names)), "var": np.array(list(adata.var_names))},
                         "VAR": {"var": np.array(list(adata.obs_names)), "obs": np.array(list(adata.var_names))}}
            
            if "X_root" in adata.obsm.keys():
                adata.obsm["X_Root"] = adata.obsm["X_root"]
                del adata.obsm["X_root"]

            self.data = adata
            print("Finished loading the data.")
    
    def find_valid_root_embedding(self,obsm):
        root = "X_root"
        for k in obsm.keys():
            if np.isnan(obsm[k]).sum()==0:
                root = k
                break
        return root

    def _initialize_user_folders(self):
        userID = self.guest_idhash+"/OBS"
        if not os.path.exists(f"{self.guest_idhash}/"):
            ID = userID.split('/')[0].split('\\')[0]
            os.makedirs(f"{userID}/nnm/")
            os.makedirs(f"{userID}/emb/")
            os.makedirs(f"{userID}/params/")
            os.makedirs(f"{userID}/pca/")
            os.makedirs(f"{userID}/obs/")
            os.makedirs(f"{userID}/var/")
            os.makedirs(f"{userID}/diff/")
            os.makedirs(f"{userID}/set/")
            os.makedirs(f"{userID}/output/")
            pickle.dump("OBS",open(f"{self.guest_idhash}/mode.p","wb"))

            os.makedirs(f"{ID}/VAR/nnm/")
            os.makedirs(f"{ID}/VAR/emb/")
            os.makedirs(f"{ID}/VAR/params/")
            os.makedirs(f"{ID}/VAR/pca/")
            os.makedirs(f"{ID}/VAR/obs/")
            os.makedirs(f"{ID}/VAR/var/")
            os.makedirs(f"{ID}/VAR/diff/") 
            os.makedirs(f"{ID}/VAR/set/")   
            os.makedirs(f"{ID}/VAR/output/")

            for k in self._obs_init.keys():
                vals = np.array(list(self._obs_init[k]))
                if isinstance(vals[0],np.integer):
                    if (len(set(vals))<500):
                        vals = vals.astype('str')

                dtype = vals.dtype
                dtype_name = dtype.name
                dtype_kind = dtype.kind
                if dtype_name == "object" and dtype_kind == "O" or dtype.type is np.str_ or dtype.type is np.string_:
                    vals = np.array([i.replace('.','_').replace('/','_') for i in vals])
                self._obs_init[k] = vals
            pickle_dumper(np.array(list(self._obs_init.index)),f"{userID}/obs/name_0.p")  

            for k in self._var_init.keys():
                vals = np.array(list(self._var_init[k]))
                if isinstance(vals[0],np.integer):
                    if (len(set(vals))<500):
                        vals = vals.astype('str')

                dtype = vals.dtype
                dtype_name = dtype.name
                dtype_kind = dtype.kind
                if dtype_name == "object" and dtype_kind == "O" or dtype.type is np.str_ or dtype.type is np.string_:
                    vals = np.array([i.replace('.','_').replace('/','_') for i in vals])
                self._var_init[k] = vals
            pickle_dumper(np.array(list(self._var_init.index)),f"{userID}/var/name_0.p") 
            
            if self._joint_mode:
                pickle_dumper(np.array(list(self._obs_init.index)),f"{ID}/VAR/var/name_0.p")  
                pickle_dumper(np.array(list(self._var_init.index)),f"{ID}/VAR/obs/name_0.p")              
                common_rest.annotations_put_worker(self,self._var_init,userID=self.guest_idhash+"/VAR", initVar=True) 
                common_rest.annotations_put_worker(self,self._obs_init,userID=userID, initVar=True)
            else:
                for col in self._obs_init:
                    vals = np.array(list(self._obs_init[col]))
                    if isinstance(vals[0],np.integer):
                        if (len(set(vals))<500):
                            vals = vals.astype('str')            
                    pickle_dumper(vals,"{}/obs/{}.p".format(userID,col.replace('/','_')))                

                for col in self._var_init:
                    vals = np.array(list(self._var_init[col]))
                    if isinstance(vals[0],np.integer):
                        if (len(set(vals))<500):
                            vals = vals.astype('str')            
                    pickle_dumper(vals,"{}/var/{}.p".format(userID,col.replace('/','_')))                

            obsm_flag = False
            for k in self._obsm_init.keys():
                k2 = k[2:] if k.startswith("X_") else k
                pickle_dumper(DataAdaptor.normalize_embedding(self._obsm_init[k]),f"{userID}/emb/{k2}.p")
                if self._obsm_init[k].shape[1] > 2:
                    pickle_dumper(self._obsm_init[k],f"{userID}/pca/{k2}.p")

                r = self._obsp_init.get("N_"+k2,self._obsp_init.get("connectivities",None))
                if r is None and len(self._obsp_init) > 0:
                    r = list(self._obsp_init.values())[0]                
                p = self._uns_init.get("N_"+k2+"_params",{})
                if r is not None:
                    pickle_dumper(r,f"{userID}/nnm/{k2}.p")
                    pickle_dumper(p,f"{userID}/params/{k2}.p")
                obsm_flag = True
            
            if not obsm_flag:
                pickle_dumper(np.zeros((self.data.shape[0],2)),f"{ID}/OBS/emb/root.p")            
            
            pickle_dumper({},f"{ID}/paired_embeddings.p")

            if self._joint_mode:
                varm_flag = False
                for k in self._varm_init.keys():
                    k2 = k[2:] if k.startswith("X_") else k
                    pickle_dumper(DataAdaptor.normalize_embedding(self._varm_init[k]),f"{ID}/VAR/emb/{k2}.p")
                    if self._varm_init[k].shape[1] > 2:
                        pickle_dumper(self._varm_init[k],f"{ID}/VAR/pca/{k2}.p")
                    
                    r = self._varp_init.get("N_"+k2,self._varp_init.get("connectivities",None))
                    if r is None and len(self._varp_init) > 0:
                        r = list(self._varp_init.values())[0]
                    if r is not None:
                        pickle_dumper(r,f"{ID}/VAR/nnm/{k2}.p")
                        pickle_dumper({},f"{ID}/VAR/params/{k2}.p")
                    varm_flag=True
            
                if not varm_flag:
                    pickle_dumper(np.zeros((self.data.shape[1],2)),f"{ID}/VAR/emb/root.p")
            
             

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
        self._var_init = self.data.var
        self._varm_init = self.data.varm
        self._varp_init = self.data.varp
        self._uns_init = self.data.uns
        self._obsp_init = self.data.obsp

        del self.data.obs
        del self.data.obsm
        del self.data.uns
        del self.data.obsp
        del self.data.varm
        del self.data.varp

        self.data.obsm[self.rootName] = self._obsm_init[self.rootName]
        self.data.obs["name_0"] = self._obs_init["name_0"]
        self.data.var["name_0"] = self._var_init["name_0"]

        self._obs_init = self._obs_init.set_index("name_0")
        self._var_init = self._var_init.set_index("name_0")

        self._obs_init.columns = pd.Index([k.replace('/','_') for k in self._obs_init.columns])
        self._var_init.columns = pd.Index([k.replace('/','_') for k in self._var_init.columns])


        # heuristic
        n_values = self.data.shape[0] * self.data.shape[1]
        if (n_values > 1e8 and self.server_config.adaptor__anndata_adaptor__backed is True) or (n_values > 5e8):
            self.parameters.update({"diffexp_may_be_slow": True})


        id = (self.get_location()+f"__{self._joint_mode}").encode()
        self.guest_idhash = base64.b32encode(blake2b(id, digest_size=5).digest()).decode("utf-8")

        print("Initializing user folders")
        self._initialize_user_folders()

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
        annotations = self.dataset_config.user_annotations        
        userID = f"{annotations._get_userdata_idhash(self)}"       
        if axis == Axis.OBS:
            if labels is not None and not labels.empty:
                labels["name_0"] = pickle_loader(f"{userID}/obs/name_0.p")
                df = labels
            else:
                df = self.data.obs
        else:
            if labels is not None and not labels.empty:
                labels["name_0"] = pickle_loader(f"{userID}/var/name_0.p")
                df = labels
            else:
                df = self.data.var
        
        if fields is not None and len(fields) > 0:
            df = df[fields]
        
        return encode_matrix_fbs(df, col_idx=df.columns)

    def get_embedding_names(self):
        annotations = self.dataset_config.user_annotations        
        userID = f"{annotations._get_userdata_idhash(self)}"
        fns = glob(f"{userID}/emb/*.p")

        x=[]
        for ann in fns:
            ann = ann.split('.p')[0].split('/')[-1].split('\\')[-1]
            x.push(ann[2:] if ann.startswith("X_") else ann)
        return x

    def get_embedding_array(self, ename, dims=2):
        annotations = self.dataset_config.user_annotations        
        userID = f"{annotations._get_userdata_idhash(self)}"
        full_embedding = pickle_loader(f"{userID}/emb/{ename}.p")[:,0:dims]
        return full_embedding

    def get_embedding_array_joint(self, ename, dims=2):
        annotations = self.dataset_config.user_annotations        
        userID = f"{annotations._get_userdata_idhash(self)}"
        ID = userID.split("/")[0].split("\\")[0]
        paired_embeddings = pickle_loader(f"{ID}/paired_embeddings.p")
        otherMode = "VAR" if (userID.split('/')[-1].split('\\')[-1] == "OBS") else "OBS"
        
        if ename in paired_embeddings:
            suffix_embedding = pickle_loader(f"{ID}/{otherMode}/emb/{paired_embeddings[ename]}.p")[:,0:dims]
            return suffix_embedding
        else:
            return np.zeros((self.NAME[otherMode]["obs"].size,2))+0.5

    def get_colors(self):
        return convert_anndata_category_colors_to_cxg_category_colors(self.data)

    def mode_getter(self):
        annotations = self.dataset_config.user_annotations        
        userID = f"{annotations._get_userdata_idhash(self)}"
        mode = userID.split("/")[-1].split("\\")[-1]
        return mode

    def get_X_array(self, col_idx, layer="X", logscale=False, scale=False):
        def bisym_log_transform(x):
             return np.sign(x)*np.log(1+np.abs(x))

        #if row_idx is None:
        #    row_idx = np.arange(self.data.shape[0])
        mode = self.mode_getter()

        XI = _read_shmem(self.shm_layers_csr,self.shm_layers_csc,layer,format="csc",mode=mode)
        
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
            if scale:
                if mode == "OBS":
                    std = (self.tMeanSqs["OBS"][layer][i1] - self.tMeans["OBS"][layer][i1]**2)
                    if std <= 0:
                        std = 1
                    std = std**0.5
                    x = (x - self.tMeans["OBS"][layer][i1])/std
                    x[x>10]=10
                    x[x<0]=0
                elif mode == "VAR":
                    mu = self.tMeans["OBS"][layer]
                    std = (self.tMeanSqs["OBS"][layer] - mu**2)
                    std[std<=0]=1
                    std=std**0.5
                    x = (x - mu[:,None]) / std[:,None]
                    x[x>10]=10
                    x[x<0]=0
        else:
            x = XI[:,col_idx]
            if logscale:
                if sparse.issparse(x):
                    x.data[:] = bisym_log_transform(x.data)
                else:
                    x = bisym_log_transform(x)

            if scale:
                x = x.A
                if mode == "OBS":
                    std = (self.tMeanSqs["OBS"][layer][col_idx] - self.tMeans["OBS"][layer][col_idx]**2)
                    std[std<=0]=1
                    std=std**0.5
                    mu = self.tMeans["OBS"][layer][col_idx]
                    x = (x - mu[None,:])/std[None,:]
                    x[x>10]=10
                    x[x<0]=0
                elif mode == "VAR":
                    std = (self.tMeanSqs["OBS"][layer] - self.tMeans["OBS"][layer]**2)
                    mu = self.tMeans["OBS"][layer]
                    std[std<=0]=1
                    std=std**0.5
                    x = (x - mu[:,None])/std[:,None]  
                    x[x>10]=10
                    x[x<0]=0         

        return x

    def get_shape(self):
        mode =  self.mode_getter()
        if mode == "OBS":
            return self.data.shape
        else:
            return (self.data.shape[1],self.data.shape[0])