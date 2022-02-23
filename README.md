<img src="./cellxgene-logo.png" width="300">

# Exploratory CellxGene (ExCellxGene)

Video vignettes to come!

### Installation

1. Install miniconda if conda not available already:

```
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-x86_64.sh -O ~/miniconda.sh
bash ~/miniconda.sh -b -p $HOME/miniconda
```

2. Create and activate a new environment (we need to install the TBB threading layer as well):

```
conda create -n cxg python=3.8
conda activate cxg
conda install tbb=2020.3 tbb-devel=2020.3
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

Ping me on the Biohub slack (@Alec) if you have any questions!
