<img src="./cellxgene-logo.png" width="300">

# Exploratory CellxGene (ExCellxGene)


## V2.9.6
The latest stable version is V2.9.6. 

### Installation

1. Install miniconda if conda not available already:

```
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-x86_64.sh -O ~/miniconda.sh
bash ~/miniconda.sh -b -p $HOME/miniconda
```

2. Create and activate a new environment:

```
conda create -n cxg python=3.11
conda activate cxg
```

3. Install excellxgene with pip:
```
pip install excellxgene
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

### Preprint on how to do manual cell-type annotation using interactive tools: 
https://www.biorxiv.org/content/10.1101/2023.07.11.548639v1

### Tutorial slides highligting some use cases:
https://cellxgene.cziscience.com/docs/05__Annotate%20and%20Analyze%20Your%20Data/5_8__Multimodal%20Annotations

More tutorial slides for multi-omics datasets (RNA, ATAC, CITE-seq, spatial transcriptomics) are coming soon (Q1/Q2 2024).
