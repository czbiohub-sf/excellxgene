<img src="./cellxgene-logo.png" width="300">

# Exploratory CellxGene (ExCellxGene)

Video vignettes to come!

## V2.9.2
The latest stable version is V2.9.2. The current version of exCellxgene relies on anndata==0.7.8, so might crash with anndata objects generated with anndata==0.8.0 or above. Until we fix this bug, we recommend users to follow the installation instruction below. The key parts are (1) installing the excellxgene version 2.9.2, and (2) upgrading the anndata version to 0.8.0 in the "cxg" conda environment.

### Installation

1. Install miniconda if conda not available already:

```
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-x86_64.sh -O ~/miniconda.sh
bash ~/miniconda.sh -b -p $HOME/miniconda
```

2. Create and activate a new environment:

```
conda create -n cxg python=3.8
conda activate cxg
```

3. Install excellxgene with pip:
```
pip install excellxgene==2.9.2
pip install anndata==0.8.0
```

If your operating system is CentOS, then you may run into issues installing dependencies that require up-to-date `gcc` or `g++` compilers. Please install with the following and try reinstalling `excellxgene` with pip:
```
conda install -c conda-forge gcc cxx-compiler
```

4. Download the git repository to get the example datasets (assumes git is available, if not install it with conda install -c anaconda git)
```
git clone https://github.com/czbiohub/excellxgene
cd excellxgene
```
Datasets are stored in `example-dataset`

5. Launch excellxgene with:
```
excellxgene launch example-dataset
```


This should launch an excellxgene session with all the datasets in example-datasets/ loaded in.

If you're running excellxgene remotely, please launch with:
```
excellxgene launch example-datasets --host 0.0.0.0
```

Tutorial slides highligting some use cases will be updated (Q2/3 2023).
