//<nowiki>
// vim: set noet sts=0 sw=8:


(function($){


/*
****************************************
*** twinkledelimages.js: Batch deletion of images (sysops only)
****************************************
* Mode of invocation:     Tab ("Deli-batch")
* Active on:              Existing non-special pages
* Config directives in:   TwinkleConfig
*/

Twinkle.delimages = function twinkledeli() {
	if( mw.config.get( 'wgNamespaceNumber' ) < 0 || !mw.config.get( 'wgCurRevisionId' ) ) {
		return;
	}
	if( Morebits.userIsInGroup( 'sysop' ) ) {
		Twinkle.addPortletLink( Twinkle.delimages.callback, "批图", "tw-deli", "批量删除此页内的文件" );
	}
};

Twinkle.delimages.unlinkCache = {};
Twinkle.delimages.callback = function twinkledeliCallback() {
	var Window = new Morebits.simpleWindow( 800, 400 );
	Window.setTitle( "批量文件删除" );
	Window.setScriptName( "Twinkle" );
	Window.addFooterLink( "Twinkle帮助", "WP:TW/DOC#delimages" );

	var form = new Morebits.quickForm( Twinkle.delimages.callback.evaluate );
	form.append( {
		type: 'checkbox',
		list: [
			{
				label: '删除文件',
				name: 'delete_image',
				value: 'delete',
				checked: true
			},
			{
				label: '取消此文件的使用',
				name: 'unlink_image',
				value: 'unlink',
				checked: true
			}
		]
	} );
	form.append( {
		type: 'textarea',
		name: 'reason',
		label: '理由：'
	} );
	var query;
	if( mw.config.get( 'wgNamespaceNumber' ) === 14 ) {  // Category:
		query = {
			'action': 'query',
			'generator': 'categorymembers',
			'gcmtitle': mw.config.get( 'wgPageName' ),
			'gcmnamespace': 6,  // File:
			'gcmlimit' : Twinkle.getPref('deliMax'), 
			'prop': [ 'imageinfo', 'categories', 'revisions' ],
			'grvlimit': 1,
			'grvprop': [ 'user' ]
		};
	} else {
		query = {
			'action': 'query',
			'generator': 'images',
			'titles': mw.config.get( 'wgPageName' ),
			'prop': [ 'imageinfo', 'categories', 'revisions' ],
			'gimlimit': 'max'
		};
	}
	var wikipedia_api = new Morebits.wiki.api( '抓取文件', query, function( self ) {
		var xmlDoc = self.responseXML;
		var images = $(xmlDoc).find('page[imagerepository="local"]');
		var list = [];

		$.each(images, function() {
			var $self = $(this);
			var image = $self.attr('title');
			var user = $self.find('imageinfo ii').attr('user');
			var last_edit = $self.find('revisions rev').attr('user');
			var disputed = $self.find('categories cl[title="Category:快速删除候选"]').size() > 0;
			list.push( {
				'label': image + '—作者：' + user + '，上次编辑：' + last_edit + ( disputed ? '（争议' : '' ),
				'value': image,
				'checked': !disputed
			});
		});

		self.params.form.append({
			type: 'checkbox',
			name: 'images',
			list: list
		});
		self.params.form.append( { type:'submit' } );

		var result = self.params.form.render();
		self.params.Window.setContent( result );
	});

	wikipedia_api.params = { form:form, Window:Window };
	wikipedia_api.post();
	var root = document.createElement( 'div' );
	Morebits.status.init( root );
	Window.setContent( root );
	Window.display();
};

Twinkle.delimages.currentDeleteCounter = 0;
Twinkle.delimages.currentUnlinkCounter = 0;
Twinkle.delimages.currentdeletor = 0;
Twinkle.delimages.callback.evaluate = function twinkledeliCallbackEvaluate(event) {
	var images = event.target.getChecked( 'images' );
	var reason = event.target.reason.value;
	var delete_image = event.target.delete_image.checked;
	var unlink_image = event.target.unlink_image.checked;
	if( ! reason ) {
		return;
	}

	Morebits.simpleWindow.setButtonsEnabled( false );
	Morebits.status.init( event.target );

	function toCall( work ) {
		if( work.length === 0 && Twinkle.delimages.currentDeleteCounter <= 0 && Twinkle.delimages.currentUnlinkCounter <= 0 ) {
			window.clearInterval( Twinkle.delimages.currentdeletor );
			Morebits.wiki.removeCheckpoint();
			return;
		} else if( work.length !== 0 && Twinkle.delimages.currentDeleteCounter <= Twinkle.getPref('batchDeleteMinCutOff') && Twinkle.delimages.currentUnlinkCounter <= Twinkle.getPref('batchDeleteMinCutOff') ) {
			Twinkle.delimages.unlinkCache = []; // Clear the cache
			var images = work.shift();
			Twinkle.delimages.currentDeleteCounter = images.length;
			Twinkle.delimages.currentUnlinkCounter = images.length;
			var i;
			for( i = 0; i < images.length; ++i ) {
				var image = images[i];
				var query = {
					'action': 'query',
					'titles': image
				};
				var wikipedia_api = new Morebits.wiki.api( '检查文件 ' + image + ' 是否存在', query, Twinkle.delimages.callbacks.main );
				wikipedia_api.params = { image:image, reason:reason, unlink_image:unlink_image, delete_image:delete_image };
				wikipedia_api.post();
			}
		}
	}
	var work = Morebits.array.chunk( images, Twinkle.getPref('deliChunks') );
	Morebits.wiki.addCheckpoint();
	Twinkle.delimages.currentdeletor = window.setInterval( toCall, 1000, work );
};
Twinkle.delimages.callbacks = {
	main: function( self ) {
		var xmlDoc = self.responseXML;
		var $data = $(xmlDoc);

		var normal = $data.find('normalized n').attr('to');

		if( normal ) {
			self.params.image = normal;
		}

		var exists = $data.find('pages page[title="'+self.params.image.replace( /"/g, '\\"')+'"]:not([missing])').size() > 0;

		if( ! exists ) {
			self.statelem.error( "文件不存在，可能已被删除" );
			return;
		}
		if( self.params.unlink_image ) {
			var query = {
				'action': 'query',
				'list': 'imageusage',
				'iutitle': self.params.image,
				'iulimit': Morebits.userIsInGroup( 'sysop' ) ? 5000 : 500 // 500 is max for normal users, 5000 for bots and sysops
			};
			var wikipedia_api = new Morebits.wiki.api( '抓取文件链接', query, Twinkle.delimages.callbacks.unlinkImageInstancesMain );
			wikipedia_api.params = self.params;
			wikipedia_api.post();
		}
		if( self.params.delete_image ) {

			var imagepage = new Morebits.wiki.page( self.params.image, '删除文件');
			imagepage.setEditSummary( "文件被删除：" + self.params.reason + Twinkle.getPref('deletionSummaryAd'));
			imagepage.deletePage();
		}
	},
	unlinkImageInstancesMain: function( self ) {
		var xmlDoc = self.responseXML;
		var instances = [];
		$(xmlDoc).find('imageusage iu').each(function(){
			instances.push($(this).attr('title'));
		});
		if( instances.length === 0 ) {
			--Twinkle.delimages.currentUnlinkCounter;
			return;
		}

		$.each( instances, function(k,title) {
			var page = new Morebits.wiki.page(title, "取消文件在" + title + " 上的使用");
			page.setFollowRedirect(true);
			page.setCallbackParameters({'image': self.params.image, 'reason': self.params.reason});
			page.load(Twinkle.delimages.callbacks.unlinkImageInstances);

		});
	},
	unlinkImageInstances: function( self ) {
		var params = self.getCallbackParameters();
		var statelem = self.getStatusElement();

		var image = params.image.replace( /^(?:Image|File|文件):/, '' );
		var old_text = self.getPageText();
		var wikiPage = new Morebits.wikitext.page( old_text );
		wikiPage.commentOutImage( image , '注释此文件因其已被删除' );
		var text = wikiPage.getText();

		if( text === old_text ) {
			statelem.error( '取消 ' + image + ' 在 ' + self.getPageName() + ' 上的使用失败' );
			return;
		}
		self.setPageText(text);
		self.setEditSummary('移除文件 ' + image + " 因其已被删除，理由为“" + params.reason + "”。" + Twinkle.getPref('deletionSummaryAd'));
		self.setCreateOption('nocreate');
		self.save();
	}
};
})(jQuery);


//</nowiki>
