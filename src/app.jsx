var SearchBar = require('./searchBar');
var SliderBlock = require('./sliderBlock');
var AcceptedSet = require('./acceptSet');
var Service = require('./appService');
require('bootstrap');


var Suggestion = function(props) {
    var onClick = function(e){
        props.acceptLease(props.data.number);
    }
    return (
        <button type="button" className="list-group-item suggestion" onClick={onClick}>
            <span className="badge">
                {props.idx}
            </span>
            {props.data.number}
        </button>
    )
};


var GroupSelectTool = React.createClass({
    prevTextLen: 0,
    depletedResults: false,
    omissions: [],
    suggestionPool: [],
    relatedPool: [],
    suggestionCount: 10,
    poolMax: 100,
    recentWeight: 0,
    mostWeight: 0,
    relatedWeight: 0,
    mostUsed: 0,
    lastUseIdx: 0,
    mostRelated: 0,
    filterText: "",


    calcRelatedScores: function(){
        var _app = this;
        _app.relatedPool.forEach((el)=> {
            el.score = (((el.lastUse ) / _app.lastUseIdx) * _app.recentWeight)
                + (((el.count ) / _app.mostUsed) * _app.mostWeight)
                + (((el.assocs ) / _app.mostRelated) * _app.relatedWeight);
        });
    },

    calcNonRelatedScores: function() {
        var _app = this;
        _app.suggestionPool.forEach((el)=> {
            el.score = (((el.lastUse ) / _app.lastUseIdx) * _app.recentWeight)
                + (((el.count ) / _app.mostUsed) * _app.mostWeight);
        });
    },

    updateWeights: function(related, recent, most){
        if(related != this.relatedWeight){
            this.relatedWeight = related;
        }
        if(recent != this.recentWeight || most != this.mostWeight){
            this.mostWeight = most;
            this.recentWeight = recent;
            this.calcNonRelatedScores();
        }
        this.calcRelatedScores();
        this.setState({suggestionList: this.combineLists()});
    },

    combineLists: function(){
        return this.relatedPool
            .concat(this.suggestionPool)
            .filter((el)=>{
                return !this.relatedPool.some((el2)=>{
                    return (el.number == el2.number && !el.assocs)
                })
            })
            .sort((a,b) => {return b.score - a.score})
            .slice(0,this.suggestionCount);
    },

    // Filter the current set of available numbers on the text.
    // If the resulting set is less than the S
    onTextChange: function(text) {
        this.filterText = text;
        var oldLen = this.prevTextLen;
        this.prevTextLen = text.length;

        // Filter the current set of condensed suggestions on the text
        var regEx = new RegExp(text);
        var tempSuggestions = this.suggestionPool.filter((el, idx, arr)=> {
            return regEx.test(el.number);
        }).slice(0, this.suggestionCount);

        var finish = ()=> {
            // Sort the pool by score
            this.suggestionPool.sort((a, b)=>{return b.score - a.score;});

            this.setState({
                suggestionList: tempSuggestions
            });
        };

        // If this text is longer that the previous text,
        // and the previous search returned less than the request amount,
        // don't bother searching. There wont be any new data.
        if(text.length > oldLen){
            if(this.depletedResults) {
                finish();
            }
            else {
                // If there are not enough leases, get more
                var deficit = this.suggestionCount - tempSuggestions.length;
                if (deficit) {
                    this.updateOmissions();
                    Service.getLeases(
                        {
                            recentRatio: this.recentWeight,
                            mostRatio: this.mostWeight,
                            limit: deficit,
                            omissions: this.omissions,
                            filterText: text
                        },
                        (data)=> {

                            // Indicate if the server depleted all suggestions for this  string
                            this.depletedResults = data.length < deficit;

                            if(data.length){

                                // Add the new data to the suggestions and the suggestion pool
                                tempSuggestions = tempSuggestions.concat(data);
                                this.suggestionPool = this.suggestionPool.concat(data);

                                // Remove extra suggestions from the pool
                                var tooMany = Math.min(this.poolMax - this.suggestionPool.length, 0);
                                if (tooMany){
                                    this.suggestionPool.splice(tooMany)
                                }

                            }
                            finish();
                        }
                    );
                }
                else {
                    finish();
                }
            }
        }
        else{
            this.depletedResults = false;
            finish();
        }
    },

    // Remove already accepted leases from the suggestion set
    cleanSuggestions: function(){
        //var before = this.suggestionPool.length;
        this.suggestionPool = this.suggestionPool.filter(( suggestion )=> {
            return !this.state.accepteds.some( (accept)=>{
                return suggestion.number === accept.number;
            } );
        });
    },

    // TODO: Figure out whether to keep filter text when clicking on a lease

    // Add a lease to the accepted set, clean the suggestion set, and
    acceptLease: function(text){
        var that = this;
        var set = text.split('\n');

        set.forEach(function(text){
            // Check if is blank or it has already been accepted
            if(!text || that.state.accepteds.some((el)=>{
                    return el.number === text;
                })){
                return;
            }
            that.state.accepteds.push({number: text, stale: false});
        });
        that.cleanSuggestions();
        that.omissions.push(text);
        that.getRelations();
        that.refs.search.clear();
    },

    toggleStale: function(idx){
        this.state.accepteds[idx].stale ^= true;
        this.state.accepteds.sort((a, b)=>{return b.stale? -1:1});
        this.getRelations();
    },

    getRelations: function(){
        var _app = this;
        var fin = function(){

            // Find most associations
            _app.mostRelated = _app.relatedPool.reduce((max, curr)=> {
                return Math.max(max, curr.assocs)
            }, -Infinity);

            // Find weighted score for each lease
            _app.calcRelatedScores();
            _app.setState({suggestionList: _app.combineLists()});
        };

        var filteredByStale = this.state.accepteds.filter(el => !el.stale);
        if(filteredByStale.length) {
            Service.getRelatedData(
                {
                    list: filteredByStale.map(el => el.number),
                    limit: this.suggestionCount,
                },
                (data)=> {
                    this.relatedPool = data;
                    fin();
                }
            );
        }
        else{
            this.relatedPool =[];
            fin();
        }
    },

    // Use the current set of accepted leases (create associations)
    commit: function(){
        // If there were no leases to commit, return
        var filteredByStale = this.state.accepteds.filter(el => !el.stale);
        if(!filteredByStale.length){
            alert("Nothing to commit");
            return;
        }

        // Filter out leases that were stale TODO: only filter leases when exceeding accept max
        this.state.accepteds = filteredByStale;

        Service.doPOST("/commit", {
            'list':this.state.accepteds.map(el => el.number)
        }, (data)=>{

            // Mark all leases as stale
            this.state.accepteds.forEach((el)=>{
                el.stale = true;
            });
            this.forceUpdate();

            Service.getMaxValues({},(data)=>{
                this.lastUseIdx = data.lastUseIdx;
                this.mostUsed = data.mostUsed;
            });
        })
    },

    handleHotkey: function(e){
        var num = parseInt(e.key);
        if(num >= 1 && num <= this.state.suggestions.length){
            this.acceptLease(this.state.suggestions[num - 1].number)
        }
    },

    // Update the ommission list
    updateOmissions: function(){
        // We don't want anything from the accepted list or the suggestion pool;
        this.omissions = this.suggestionPool.map(el => el.number);
        this.omissions = this.omissions.concat(this.state.accepteds.map(el => el.number));
    },

    // Initialize the App by setting the state to all empty arrays
    getInitialState: function() {
        return {
            suggestionList: [],
            accepteds: [],
        };
    },

    // Initialize the App by getting the most used and recently used leases
    componentDidMount: function() {
        Service.getLeases({
            limit: this.suggestionCount,
        },(data)=>{
            this.suggestionPool = data;
            this.setState({
                suggestionList: this.suggestionPool.slice(0, this.suggestionCount)
            });
        });
        this.getMaxValues();
        //document.addEventListener('keydown',this.handleHotkey,false);
    },
    getMaxValues: function(){
        Service.getMaxValues({},(data)=>{
            this.lastUseIdx = data.lastUseIdx;
            this.mostUsed = data.mostUsed;
        });
    },
    render: function(){
        var suggestions = this.state.suggestionList.map((result, i) => {
            return <Suggestion key={i} data={result} idx={i+1} acceptLease={this.acceptLease}/>
        });
        return(
            <div className="app">
                <SearchBar acceptLease={this.acceptLease} handleTextChange={this.onTextChange} ref="search"/>

                <div className="search-and-suggest">
                    <div className="suggest">
                        <div className="list-group">
                            {suggestions}
                        </div>
                        {!this.state.suggestionList.length &&
                            <h2>
                                No Matches
                            </h2>
                        }
                    </div>

                    <SliderBlock updateWeights={this.updateWeights}/>
                </div>

                <AcceptedSet
                    data={this.state.accepteds}
                    commit={this.commit}
                    toggleStale={this.toggleStale}
                />
            </div>
        );
    }
})

ReactDOM.render(
    <GroupSelectTool/>,
    document.getElementById('content')
);