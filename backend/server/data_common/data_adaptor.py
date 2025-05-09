from abc import ABCMeta, abstractmethod
from os.path import basename, splitext
import numpy as np
import pandas as pd
from scipy import sparse
from server_timing import Timing as ServerTiming

from backend.server.common.config.app_config import AppConfig
from backend.common.constants import Axis
from backend.common.errors import FilterError, JSONEncodingValueError, ExceedsLimitError, UnsupportedSummaryMethod
from backend.common.utils.utils import jsonify_numpy
from backend.common.fbs.matrix import encode_matrix_fbs
from backend.common.genesets import validate_gene_sets


class DataAdaptor(metaclass=ABCMeta):
    """Base class for loading and accessing matrix data"""

    def __init__(self, data_locator, app_config, dataset_config=None):
        if not isinstance(app_config, AppConfig):
            raise TypeError("config expected to be of type AppConfig")

        # location to the dataset
        self.data_locator = data_locator

        # config is the application configuration
        self.app_config = app_config
        self.server_config = self.app_config.server_config
        self.dataset_config = dataset_config or app_config.dataset_config

        # parameters set by this data adaptor based on the data.
        self.parameters = {}

    @staticmethod
    @abstractmethod
    def pre_load_validation(data_locator):
        pass

    @staticmethod
    @abstractmethod
    def open(data_locator, app_config, dataset_config):
        pass

    @staticmethod
    @abstractmethod
    def file_size(data_locator):
        pass

    @abstractmethod
    def get_name(self):
        """return a string name for this data adaptor"""
        pass

    @abstractmethod
    def get_library_versions(self):
        """return a dictionary of library name to library versions"""
        pass

    @abstractmethod
    def get_embedding_names(self):
        """return a list of pre-computed embedding names"""
        pass

    @abstractmethod
    def get_embedding_array(self, ename, dims=2):
        """return an numpy array for the given pre-computed embedding name."""
        pass

    @abstractmethod
    def compute_sankey_df(self, labels, name):
        """compute sankey"""
        pass

    @abstractmethod
    def compute_embedding(self, method, filter, reembedParams):
        """compute a new embedding on the specified obs subset and return the embedding schema."""
        pass

    @abstractmethod
    def get_X_array(self, col_idx):
        """return the X array, possibly filtered by obs_mask or var_mask.
        the return type is either ndarray or scipy.sparse.spmatrix."""
        pass

    @abstractmethod
    def get_shape(self):
        pass

    @abstractmethod
    def get_colors(self):
        pass

    @abstractmethod
    def cleanup(self):
        pass

    def get_data_locator(self):
        return self.data_locator

    def get_location(self):
        return self.data_locator.uri_or_path

    def get_about(self):
        return None

    def get_title(self):
        # default to file name
        location = self.get_location()
        if location.endswith("/"):
            location = location[:-1]
        return splitext(basename(location))[0]

    def get_corpora_props(self):
        return None

    @abstractmethod
    def annotation_to_fbs_matrix(self, axis, field=None, uid=None):
        """
        Gets annotation value for each observation
        :param axis: string obs or var
        :param fields: list of keys for annotation to return, returns all annotation values if not set.
        :return: flatbuffer: in fbs/matrix.fbs encoding
        """
        pass

    def update_parameters(self, parameters):
        parameters.update(self.parameters)

    def _index_filter_to_mask(self, filter, count):
        mask = np.zeros((count,), dtype="bool")
        for i in filter:
            if isinstance(i, list):
                mask[i[0] : i[1]] = True
            else:
                mask[i] = True
        return mask

    def _axis_filter_to_mask(self, axis, filter, count):
        mask = np.ones((count,), dtype="bool")
        if "index" in filter:
            mask = np.logical_and(mask, self._index_filter_to_mask(filter["index"], count))
        if "annotation_value" in filter:
            mask = np.logical_and(mask, self._annotation_filter_to_mask(axis, filter["annotation_value"], count))

        return mask

    def _annotation_filter_to_mask(self, axis, filter, count):
        mask = np.ones((count,), dtype="bool")
        for v in filter:
            name = v["name"]
            if axis == Axis.VAR:
                anno_data = self.NAME[self.mode_getter()]["var"]
            elif axis == Axis.OBS:
                anno_data = self.NAME[self.mode_getter()]["obs"]

            if anno_data.dtype.name in ["boolean", "category", "object"]:
                values = v.get("values", [])
                key_idx = np.in1d(anno_data, values)
                mask = np.logical_and(mask, key_idx)

            else:
                min_ = v.get("min", None)
                max_ = v.get("max", None)
                if min_ is not None:
                    key_idx = (anno_data >= min_).ravel()
                    mask = np.logical_and(mask, key_idx)
                if max_ is not None:
                    key_idx = (anno_data <= max_).ravel()
                    mask = np.logical_and(mask, key_idx)

        return mask

    def _filter_to_mask(self, filter):
        """
        Return the filter as a row and column selection list.
        No filter on a dimension means 'all'
        """
        shape = self.get_shape()
        var_selector = None
        obs_selector = None
        if filter is not None:
            if Axis.OBS in filter:
                obs_selector = self._axis_filter_to_mask(Axis.OBS, filter["obs"], shape[0])

            if Axis.VAR in filter:
                var_selector = self._axis_filter_to_mask(Axis.VAR, filter["var"], shape[1])

        return (obs_selector, var_selector)

    def check_new_labels(self, labels_df):
        """Check the new annotations labels, then set the labels_df index"""
        if labels_df is None or labels_df.empty:
            return

        labels_df.index = self.NAME[self.mode_getter()]["obs"]
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

    def check_new_gene_sets(self, genesets, context=None):
        var_names = set(self.NAME[self.mode_getter()]["var"])
        return validate_gene_sets(genesets, var_names)

    def data_frame_to_fbs_matrix(self, filter, axis, layer="X", logscale=False, scale=False, mode="OBS"):
        """
        Retrieves data 'X' and returns in a flatbuffer Matrix.
        :param filter: filter: dictionary with filter params
        :param axis: string obs or var
        :return: flatbuffer Matrix

        Caveats:
        * currently only supports access on VAR axis
        * currently only supports filtering on VAR axis
        """

        if axis != Axis.VAR:
            raise ValueError("Only VAR dimension access is supported")
        try:
            d = filter["var"]["annotation_value"][0]
            col = self.NAME[mode]["var"]
            vals = d["values"]
            var_selector = np.in1d(col, vals)

        except (KeyError, IndexError, TypeError, AttributeError):
            raise FilterError("Error parsing filter")

        col_idx = np.nonzero([] if var_selector is None else var_selector)[0]
        X = self.get_X_array(col_idx, layer=layer, logscale=logscale, scale=scale)

        return encode_matrix_fbs(X, col_idx=col_idx, row_idx=None)

    def diffexp_topN(self, obsFilterA, obsFilterB, top_n=None):
        """
        Computes the top N differentially expressed variables between two observation sets. If mode
        is "TOP_N", then stats for the top N
        dataframes
        contain a subset of variables, then statistics for all variables will be returned, otherwise
        only the top N vars will be returned.
        :param obsFilterA: filter: dictionary with filter params for first set of observations
        :param obsFilterB: filter: dictionary with filter params for second set of observations
        :param top_n: Limit results to top N (Top var mode only)
        :return: top N genes and corresponding stats
        """
        if Axis.VAR in obsFilterA or Axis.VAR in obsFilterB:
            raise FilterError("Observation filters may not contain variable conditions")
        try:
            shape = self.get_shape()
            obs_mask_A = self._axis_filter_to_mask(Axis.OBS, obsFilterA["obs"], shape[0])
            obs_mask_B = self._axis_filter_to_mask(Axis.OBS, obsFilterB["obs"], shape[0])
        except (KeyError, IndexError):
            raise FilterError("Error parsing filter")
        if top_n is None:
            top_n = self.dataset_config.diffexp__top_n

        if self.server_config.exceeds_limit(
            "diffexp_cellcount_max", np.count_nonzero(obs_mask_A) + np.count_nonzero(obs_mask_B)
        ):
            raise ExceedsLimitError("Diffexp request exceeds max cell count limit")

        result = self.compute_diffexp_ttest(
            maskA=obs_mask_A,
            maskB=obs_mask_B,
            top_n=top_n,
            lfc_cutoff=self.dataset_config.diffexp__lfc_cutoff,
        )

        try:
            return jsonify_numpy(result)
        except ValueError:
            raise JSONEncodingValueError("Error encoding differential expression to JSON")

    @abstractmethod
    def compute_diffexp_ttest(self, maskA, maskB, top_n, lfc_cutoff):
        pass

    @staticmethod
    def normalize_embedding(embedding):
        """Normalize embedding layout to meet client assumptions.
        Embedding is an ndarray, shape (n_obs, n)., where n is normally 2
        """

        # scale isotropically
        try:
            min = np.nanmin(embedding, axis=0)
            max = np.nanmax(embedding, axis=0)
        except RuntimeError:
            # indicates entire array was NaN, which should propagate
            min = np.NaN
            max = np.NaN

        diff = max - min
        if np.abs(diff).sum() == 0:
            normalized_layout = embedding
            normalized_layout[np.invert(np.isnan(normalized_layout))] = 0.5
        else:
            scale = np.amax(max - min)
            normalized_layout = (embedding - min) / scale

            # translate to center on both axis
            translate = 0.5 - ((max - min) / scale / 2)
            normalized_layout = normalized_layout + translate

            normalized_layout = normalized_layout.astype(dtype=np.float32)
        return normalized_layout

    def layout_to_fbs_matrix(self, fields):
        """
        return specified embeddings as a flatbuffer, using the cellxgene matrix fbs encoding.

        * returns only first two dimensions, with name {ename}_0 and {ename}_1,
          where {ename} is the embedding name.
        * client assumes each will be individually centered & scaled (isotropically)
          to a [0, 1] range.
        * does not support filtering

        """
        embeddings = self.get_embedding_names() if fields is None or len(fields) == 0 else fields
        layout_data = []
        with ServerTiming.time("layout.query"):
            for ename in embeddings:
                normalized_layout = self.get_embedding_array(ename, 2)
                layout_data.append(pd.DataFrame(normalized_layout, columns=[f"{ename}_0", f"{ename}_1"]))

        with ServerTiming.time("layout.encode"):
            if layout_data:
                df = pd.concat(layout_data, axis=1, copy=False)
            else:
                df = pd.DataFrame()
            fbs = encode_matrix_fbs(df, col_idx=df.columns, row_idx=None)

        return fbs

    def layout_to_fbs_matrix_joint(self, fields):
        """
        return specified embeddings as a flatbuffer, using the cellxgene matrix fbs encoding.

        * returns only first two dimensions, with name {ename}_0 and {ename}_1,
          where {ename} is the embedding name.
        * client assumes each will be individually centered & scaled (isotropically)
          to a [0, 1] range.
        * does not support filtering

        """
        embeddings = self.get_embedding_names() if fields is None or len(fields) == 0 else fields
        layout_data = []
        with ServerTiming.time("layout.query"):
            for ename in embeddings:
                normalized_layout = self.get_embedding_array_joint(ename, 2)
                layout_data.append(pd.DataFrame(normalized_layout, columns=[f"{ename}_0", f"{ename}_1"]))

        with ServerTiming.time("layout.encode"):
            if layout_data:
                df = pd.concat(layout_data, axis=1, copy=False)
            else:
                df = pd.DataFrame()
            fbs = encode_matrix_fbs(df, col_idx=df.columns, row_idx=None)

        return fbs

    def get_last_mod_time(self):
        try:
            lastmod = self.get_data_locator().lastmodtime()
        except RuntimeError:
            lastmod = None
        return lastmod

    def summarize_var(self, method, filter, query_hash, layer="X", logscale=False, scale=False):
        if method != "mean":
            raise UnsupportedSummaryMethod("Unknown gene set summary method.")

        d = filter["var"]["annotation_value"][0]
        col = self.NAME[self.mode_getter()]["var"]
        vals = d["values"]
        var_selector = np.in1d(col, vals)
        if var_selector is None or np.count_nonzero(var_selector) == 0:
            mean = np.zeros((self.get_shape()[0], 1), dtype=np.float32)
        else:
            col_idx = np.nonzero([] if var_selector is None else var_selector)[0]
            X = self.get_X_array(col_idx, layer=layer, logscale=logscale, scale=scale)
            if sparse.issparse(X):
                mean = X.mean(axis=1)
            else:
                mean = X.mean(axis=1, keepdims=True)

        col_idx = pd.Index([query_hash])
        return encode_matrix_fbs(mean, col_idx=col_idx, row_idx=None)
