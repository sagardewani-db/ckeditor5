/**
 * Copyright (c) 2016 - 2017, CKSource - Frederico Knabben. All rights reserved.
 */

/* globals document, window */

import ModelText from '@ckeditor/ckeditor5-engine/src/model/text';
import ModelRange from '@ckeditor/ckeditor5-engine/src/model/range';
import ClassicTestEditor from '@ckeditor/ckeditor5-core/tests/_utils/classictesteditor';
import Autosave from '../src/autosave';
import Paragraph from '@ckeditor/ckeditor5-paragraph/src/paragraph';
import PendingActions from '@ckeditor/ckeditor5-core/src/pendingactions';

describe( 'Autosave', () => {
	const sandbox = sinon.sandbox.create();
	let editor, element, autosave;

	beforeEach( () => {
		element = document.createElement( 'div' );
		document.body.appendChild( element );

		return ClassicTestEditor
			.create( element, {
				plugins: [ Autosave, Paragraph ]
			} )
			.then( _editor => {
				const data = '<p>paragraph1</p><p>paragraph2</p>';

				editor = _editor;
				editor.setData( data );
				autosave = editor.plugins.get( Autosave );

				// Clean autosave's state after setting data.
				autosave._flush();
			} );
	} );

	afterEach( () => {
		document.body.removeChild( element );
		sandbox.restore();

		return editor.destroy();
	} );

	it( 'should have static pluginName property', () => {
		expect( Autosave.pluginName ).to.equal( 'Autosave' );
	} );

	describe( 'initialization', () => {
		it( 'should initialize provider with an undefined value', () => {
			expect( autosave.provider ).to.be.undefined;
		} );

		it( 'should allow plugin to work without any defined provider', () => {
			editor.model.change( writer => {
				writer.setSelection( ModelRange.createIn( editor.model.document.getRoot().getChild( 0 ) ) );
				editor.model.insertContent( new ModelText( 'foo' ), editor.model.document.selection );
			} );

			autosave._flush();
		} );
	} );

	describe( 'autosaving', () => {
		it( 'should run provider\'s save method when the editor\'s change event is fired', () => {
			autosave.provider = {
				save: sinon.spy()
			};

			editor.model.change( writer => {
				writer.setSelection( ModelRange.createIn( editor.model.document.getRoot().getChild( 0 ) ) );
				editor.model.insertContent( new ModelText( 'foo' ), editor.model.document.selection );
			} );

			// Go to the next cycle to because synchronization of CS documentVersion is async.
			autosave._flush();

			sinon.assert.calledOnce( autosave.provider.save );
		} );

		it( 'should throttle editor\'s change event', () => {
			const spy = sinon.spy();
			const savedStates = [];

			autosave.provider = {
				save() {
					spy();

					savedStates.push( editor.getData() );
				}
			};

			// Leading (will fire change).
			editor.model.change( writer => {
				writer.setSelection( ModelRange.createIn( editor.model.document.getRoot().getChild( 1 ) ) );
				editor.model.insertContent( new ModelText( 'foo' ), editor.model.document.selection );
			} );

			// Throttled (won't fire change).
			editor.model.change( writer => {
				writer.setSelection( ModelRange.createIn( editor.model.document.getRoot().getChild( 1 ) ) );
				editor.model.insertContent( new ModelText( 'bar' ), editor.model.document.selection );
			} );

			// Flushed (will fire change).
			editor.model.change( writer => {
				writer.setSelection( ModelRange.createIn( editor.model.document.getRoot().getChild( 1 ) ) );
				editor.model.insertContent( new ModelText( 'biz' ), editor.model.document.selection );
			} );

			autosave._flush();

			expect( spy.callCount ).to.equal( 2 );
			expect( savedStates ).to.deep.equal( [
				'<p>paragraph1</p><p>foo</p>',
				'<p>paragraph1</p><p>biz</p>'
			] );
		} );

		it( 'should add a pending action during the saving.', () => {
			const serverActionSpy = sinon.spy();
			const pendingActions = editor.plugins.get( PendingActions );

			autosave.provider = {
				save() {
					return wait5ms()
						.then( serverActionSpy );
				}
			};

			editor.model.change( writer => {
				writer.setSelection( ModelRange.createIn( editor.model.document.getRoot().getChild( 0 ) ) );
				editor.model.insertContent( new ModelText( 'foo' ), editor.model.document.selection );
			} );

			autosave._flush();

			sinon.assert.notCalled( serverActionSpy );
			expect( pendingActions.isPending ).to.be.true;
			expect( pendingActions.first.message ).to.equal( 'Saving in progress.' );

			return wait5ms().then( () => {
				sinon.assert.calledOnce( serverActionSpy );
				expect( pendingActions.isPending ).to.be.false;
			} );
		} );

		it( 'should add a pending action during the saving #2.', () => {
			const serverActionSpy = sinon.spy();
			const pendingActions = editor.plugins.get( PendingActions );

			autosave.provider = {
				save() {
					serverActionSpy();
				}
			};

			expect( pendingActions.isPending ).to.be.false;

			editor.model.change( writer => {
				writer.setSelection( ModelRange.createIn( editor.model.document.getRoot().getChild( 0 ) ) );
				editor.model.insertContent( new ModelText( 'foo' ), editor.model.document.selection );
			} );

			expect( pendingActions.isPending ).to.be.true;

			autosave._flush();

			// Server action needs to wait at least a cycle.
			return Promise.resolve().then( () => {
				expect( pendingActions.isPending ).to.be.false;
			} );
		} );

		it( 'should filter out changes in the selection', () => {
			autosave.provider = {
				save: sandbox.spy()
			};

			editor.model.change( writer => {
				writer.setSelection( ModelRange.createIn( editor.model.document.getRoot().getChild( 0 ) ) );
			} );

			autosave._flush();
			sinon.assert.notCalled( autosave.provider.save );
		} );

		it( 'should filter out markers that does not affect the data model', () => {
			autosave.provider = {
				save: sandbox.spy()
			};

			const range = ModelRange.createIn( editor.model.document.getRoot().getChild( 0 ) );
			const range2 = ModelRange.createIn( editor.model.document.getRoot().getChild( 1 ) );

			editor.model.change( writer => {
				writer.addMarker( 'name', { usingOperation: true, affectsData: false, range } );
			} );

			autosave._flush();

			editor.model.change( writer => {
				writer.updateMarker( 'name', { range: range2 } );
			} );

			autosave._flush();

			sinon.assert.notCalled( autosave.provider.save );
		} );

		it( 'should filter out markers that does not affect the data model #2', () => {
			autosave.provider = {
				save: sandbox.spy()
			};

			const range = ModelRange.createIn( editor.model.document.getRoot().getChild( 0 ) );
			const range2 = ModelRange.createIn( editor.model.document.getRoot().getChild( 1 ) );

			editor.model.change( writer => {
				writer.addMarker( 'name', { usingOperation: false, affectsData: false, range } );
			} );

			autosave._flush();

			editor.model.change( writer => {
				writer.updateMarker( 'name', { range: range2 } );
			} );

			autosave._flush();

			sinon.assert.notCalled( autosave.provider.save );
		} );

		it( 'should call the save method when some marker affects the data model', () => {
			autosave.provider = {
				save: sandbox.spy()
			};

			const range = ModelRange.createIn( editor.model.document.getRoot().getChild( 0 ) );
			const range2 = ModelRange.createIn( editor.model.document.getRoot().getChild( 1 ) );

			editor.model.change( writer => {
				writer.addMarker( 'name', { usingOperation: true, affectsData: true, range } );
			} );

			autosave._flush();

			editor.model.change( writer => {
				writer.updateMarker( 'name', { range: range2 } );
			} );

			autosave._flush();

			sinon.assert.calledTwice( autosave.provider.save );
		} );

		it( 'should call the save method when some marker affects the data model #2', () => {
			autosave.provider = {
				save: sandbox.spy()
			};

			const range = ModelRange.createIn( editor.model.document.getRoot().getChild( 0 ) );
			const range2 = ModelRange.createIn( editor.model.document.getRoot().getChild( 1 ) );

			editor.model.change( writer => {
				writer.addMarker( 'name', { usingOperation: false, affectsData: true, range } );
			} );

			autosave._flush();
			sinon.assert.calledOnce( autosave.provider.save );

			editor.model.change( writer => {
				writer.updateMarker( 'name', { range: range2 } );
			} );

			autosave._flush();

			sinon.assert.calledTwice( autosave.provider.save );
		} );

		it( 'should call the save method when some marker affects the data model #3', () => {
			autosave.provider = {
				save: sandbox.spy()
			};

			const range = ModelRange.createIn( editor.model.document.getRoot().getChild( 0 ) );

			editor.model.change( writer => {
				writer.addMarker( 'marker-not-affecting-data', { usingOperation: false, affectsData: true, range } );
				writer.addMarker( 'marker-affecting-data', { usingOperation: false, affectsData: false, range } );
			} );

			autosave._flush();
			sinon.assert.calledOnce( autosave.provider.save );
		} );

		it( 'should flush remaining calls after editor\'s destroy', () => {
			const spy = sandbox.spy();
			const savedStates = [];

			autosave.provider = {
				save() {
					spy();

					savedStates.push( editor.getData() );
				}
			};

			editor.model.change( writer => {
				writer.setSelection( ModelRange.createIn( editor.model.document.getRoot().getChild( 0 ) ) );
				editor.model.insertContent( new ModelText( 'foo' ), editor.model.document.selection );
			} );

			editor.model.change( writer => {
				writer.setSelection( ModelRange.createIn( editor.model.document.getRoot().getChild( 1 ) ) );
				editor.model.insertContent( new ModelText( 'bar' ), editor.model.document.selection );
			} );

			return editor.destroy().then( () => {
				expect( spy.callCount ).to.equal( 2 );
				expect( savedStates ).to.deep.equal( [
					'<p>foo</p><p>paragraph2</p>',
					'<p>foo</p><p>bar</p>',
				] );
			} );
		} );

		it( 'should work after editor\'s destroy with long server\'s action time', () => {
			const serverActionSpy = sinon.spy();
			const pendingActions = editor.plugins.get( PendingActions );

			autosave.provider = {
				save() {
					return wait5ms()
						.then( serverActionSpy );
				}
			};

			editor.model.change( writer => {
				writer.setSelection( ModelRange.createIn( editor.model.document.getRoot().getChild( 0 ) ) );
				editor.model.insertContent( new ModelText( 'foo' ), editor.model.document.selection );
			} );

			return editor.destroy()
				.then( () => {
					expect( pendingActions.isPending ).to.be.true;
				} )
				.then( wait5ms )
				.then( () => {
					expect( pendingActions.isPending ).to.be.false;
				} );
		} );
	} );

	function wait5ms() {
		return new Promise( res => {
			window.setTimeout( res, 5 );
		} );
	}
} );
