require('dotenv').config();
const express = require('express');  
const request = require('request');
const session = require('express-session');
const fs = require('fs');
const https = require('https');
const cors = require('cors');
const Amadeus = require('amadeus');
const { image_search, image_search_generator } = require("duckduckgo-images-api");
const { response } = require('express');
const WebSocket = require('ws');

var app = express(); // Express configuration

app.use(express.static(__dirname + '/public')); // serve perchè altrimenti non si carica il file html che contiene la documentazione sulle Api esterne
//Non cambiare il nome della cartella public, altrimenti devi cambiarlo anche qui e anche sotto.
//app.use(express.urlencoded({ extended: false }));
app.use(cors()); //cors policy

app.use(session({ //SESSION
	secret: 'RDC-progetto',
	resave: true,
	saveUninitialized: false,
}));

const options = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem')
};

const port = 3000;

var amadeus = new Amadeus({
	clientId: process.env.AMADEUS_KEY,
	clientSecret: process.env.AMADEUS_SECRET
});

var client_id = process.env.CLIENT_ID_FB;
var client_secret = process.env.CLIENT_SECRET_FB;

var userdb = 'http://admin:admin@localhost:5984/users/';
var itinerariesdb = 'http://admin:admin@localhost:5984/itineraries/';

const GADB = fs.readFileSync('GlobalAirportDatabase.txt').toString().split("\n").map(function(v) {
	let values = v.split(":");
	let object = {
		IATA: values[1], 
		airport: values[2], 
		city: values[3], 
		country: values[4]
	}
	return object;
});

app.get('/', function(req,res) {
	console.log(req.session);
	console.log(req.sessionID);
	if(typeof(req.session.user) != "undefined") {
		console.log("QUERY: "+JSON.stringify(req.query));
		console.log("SESSION: "+JSON.stringify(req.session));
		res.sendFile("home.html",{root:__dirname});
	}
	else
		res.sendFile("accesso.html",{root:__dirname});
});

app.get('/login', function(req,res) {
	console.log("hoh");
	res.redirect(`https://www.facebook.com/v10.0/dialog/oauth?response_type=code&scope=email&client_id=${client_id}&redirect_uri=https://localhost:3000/home&client_secret=${client_secret}`);
});

app.get('/logout', function(req, res){
	req.session.destroy();
	res.redirect('/');
});

app.get('/home', function(req,res) {
	if(req.query.error=='access_denied'){
		console.log("Non autorizzato");
		res.redirect('/');
	}
	else if(req.query.code!=null || req.session.code!=null) {
		var code= req.query.code;
		request.get({
			url:`https://graph.facebook.com/v10.0/oauth/access_token?client_id=${client_id}&redirect_uri=https://localhost:3000/home&client_secret=${client_secret}&code=${code}`
		}, function(err, res_get, body) {
			if (err) {
				return console.error('Auth failed:', err);
			}
			var info = JSON.parse(body);
			console.log("QUERY:"+JSON.stringify(req.query));
			console.log("BODY:"+body);
			if(info.error) {
				res.redirect("/");
			}
			else {
				userInfo(info.access_token).then(function(response) {
					readCRUD(userdb, {"id": response.id}).then(function(res_read) {
						req.session.token = info.access_token;
						req.session.user = res_read;
						res.sendFile("home.html",{root:__dirname});						
					}).catch(function(err_read) {
						createCRUD(userdb, {"id": response.id, "token": info.access_token, "nome": response.name, "mete": []}).then(function(res_create) {
							req.session.token = info.access_token;
							req.session.user = {"_id": response.id, "token": info.access_token, "nome": response.name, "mete": []};
							res.sendFile("home.html",{root:__dirname});
						}).catch((err_create)=>console.log(err_create));
					});
				}).catch(function(err) {
					console.log(err);
					res.redirect("/");
				});
			}
		});
	} 
	else {
		res.redirect("/");
	}
});

app.get('/GADB', function(req,res) {
	console.log("sent GADB");
	res.send(GADB);
});

app.get('/profilo', function(req, res) {
	res.sendFile("profilo.html",{root:__dirname});
});
app.get('/test', ()=>console.log("test"));
app.get('/profilo_dati', function(req, res) {
	console.log(req.session);
	console.log(req.session.user);
	readCRUD(userdb,{"id":req.session.user._id}).then(function(res_readu) {
		console.log("READU--------------------------------");
		console.log(res_readu);
		req.session.user = res_readu;
		console.log("ASESSIONUSER--------------------------------");
		console.log(req.session.user);
		console.log("SENT DATA, DONE!--------------------------------");
		res.send(req.session.user);
	}).catch((err)=>console.log(err));
});

app.get('/mete', function(req,res) {
	res.sendFile("mete.html",{root:__dirname});
});

app.get('/cerca_itinerari', function(req,res) {
	console.log(req.query);

	cercaItinerari(req.query.origin,req.query.destination,req.query.departureDate).then(function(response){
		if(response.data.length == 0)
			res.send("Nessun itinerario trovato");
		else
			res.send(JSON.stringify(response.data));
	}).catch(function(responseError){
		console.log(responseError.code);
		res.send("Errore nel server");
	});

});

app.get('/meta_dettagli', function(req,res) {
	console.log(req.session);
	console.log(req.sessionID);
	console.log(req.session.user);
	console.log("TIPO-------------");
	console.log(typeof(req.session.user));
	console.log("TIPO-------------");
	if(typeof(req.session.user) != "undefined") {
		console.log("QUERY: "+JSON.stringify(req.query));
		console.log("SESSION: "+JSON.stringify(req.session));
		res.sendFile("meta_dettagli.html",{root:__dirname});
	}
	else
		res.sendFile("accesso.html",{root:__dirname});
});

app.get('/meta_dettagli_data', function(req,res) {
	console.log(req.query);
	cercaItinerari(req.query.origin,req.query.destination,req.query.departureDate).then(function(response){
		if(response.data.length == 0)
			res.send("Nessun itinerario trovato");
		else {
			let itinerario = response.data.filter(function(v) {
				return v.itineraries[0].duration == req.query.durata &&
				v.lastTicketingDate == req.query.disponib &&
				v.price.grandTotal == req.query.prezzo;
			})[0];
			res.send(JSON.stringify(itinerario));
		}
	}).catch(function(responseError){
		console.log(responseError.code);
		res.send("Errore nel server");
	});
});

app.get('/photo', function(req,res) {
	console.log(req.query);
	let place = req.query.place;
	image_search({ 
		query: place, 
		moderate: true 
	}).then(function(results) {
//		console.log(results[0]);
		for(let i = 0; i < results.length; i++) {
			if(results[i].image.includes("https:")) {
				res.send(results[i].image);
				break;
			}
		}
	}).catch(function(err) {
		console.log("Errore");
		res.send("ERRORE");
	});
});

app.get('/airline_data', function(req,res) {
	var code = req.query.code;
	console.log(code);
	/*
	amadeus.referenceData.airlines.get({
		airlineCodes : code
	}).then(function(response0){
		amadeus.referenceData.urls.checkinLinks.get({
			airlineCode : code
		}).then(function(response1){
			var obj = {"airline": response0.data, "urls": response1.data};
			console.log(JSON.stringify(obj));
			res.send(obj);
		}).catch(function(response1Error){
			console.log(responseError);
			res.send(responseError);
		});
	}).catch(function(response0Error){
		res.send(response0Error);
	});
	*/
	
	//TESTING MODE:
	var data = JSON.parse(fs.readFileSync('test_airline_data.json'));
	console.log(data);
	res.send(data);
});

app.get('/preferito_aggiungi', function(req,res) {

	function aux() {
		readCRUD(userdb,{"id": req.query.user}).then(function(res_readu) { //...LEGGO POI I DATI DELL'UTENTE...
			let new_itineraries = res_readu.mete;
			new_itineraries.push(req.query.meta_id);
			let user = {
				"id": res_readu._id,
				"token": res_readu.token,
				"nome": res_readu.nome,
				"mete": new_itineraries
			}
			updateCRUD(userdb,user).then(function(res_updateu) { //...E AGGIORNO IL SUO ARRAY INSERENDO L'ITINERARIO.
				console.log(req.session.user);
				req.session.user.mete = new_itineraries;
				console.log(req.session.user);
				res.send("useless data");
			}).catch(function(err_updateu) { console.log(err_updateu); res.send("useless data"); });
		}).catch(function(err_readu) { console.log(err_readu); res.send("useless data"); });
	}

	readCRUD(itinerariesdb, {"id": req.query.meta_id}).then(function(res_readi) { //L'ITINERARIO ESISTE IN DB...
		let obj = {
			"id": res_readi._id,
			"origin": res_readi.origin,
			"destination": res_readi.destination,
			"departureDate": res_readi.departureDate,
			"price": res_readi.price,
			"currency": res_readi.currency,
			"duration": res_readi.duration,
			"lastTicketingDate": res_readi.lastTicketingDate,
			"userN": res_readi.userN+1
		};
		updateCRUD(itinerariesdb, obj).then(function(res_updatei) { //...QUINDI AGGIORNO QUELL'ITINERARIO IN DB (userN+1)...
			aux();
		}).catch(function(err_updatei) { console.log(err_updatei); res.send("useless data"); });
	}).catch(function(err_readi) { //SE INVECE L'ITINERARIO NON ESISTE IN DB...
		let obj = {
			"id": req.query.meta_id,
			"origin": req.query.origin,
			"destination": req.query.destination,
			"departureDate": req.query.departureDate,
			"price": req.query.prezzo,
			"currency": req.query.currency,
			"duration": req.query.durata,
			"lastTicketingDate": req.query.disponib,
			"userN": 1
		};
		createCRUD(itinerariesdb,obj).then(function(res_createi) { //...LO CREO E LO INSERISCO IN DB...
			aux();
		}).catch(function(err_createi) { console.log(err_createi); res.send("useless data"); });
		console.log(err_readi)
	});
});

/*-------------------------------------------*/
app.get('/preferito_rimuovi', function(req,res) {
	function aux() {
		readCRUD(userdb,{"id": req.query.user}).then(function(res_readu) { //...LEGGO POI I DATI DELL'UTENTE...
			let new_itineraries = res_readu.mete;

			index = new_itineraries.indexOf(req.query.meta_id);				
			new_itineraries.splice(index,1);					//creo nuovo array senza meta che utente ha eliminato
			console.log(new_itineraries);

			let user = {
				"id": res_readu._id,
				"token": res_readu.token,
				"nome": res_readu.nome,
				"mete": new_itineraries
			}

			updateCRUD(userdb,user).then(function(res_updateu) { //...E AGGIORNO IL SUO ARRAY TOGLIENDO L'ITINERARIO.
				console.log(req.session.user);
				req.session.user.mete = new_itineraries;
				console.log(req.session.user);
				res.send("useless data");
			}).catch(function(err_updateu) { console.log(err_updateu); res.send("useless data"); });
		}).catch(function(err_readu) { console.log(err_readu); res.send("useless data"); });
	};

	readCRUD(itinerariesdb, {"id": req.query.meta_id}).then(function(res_readi) { //L'ITINERARIO ESISTE IN DB...
		let obj = {
			"id": res_readi._id,
			"origin": res_readi.origin,
			"destination": res_readi.destination,
			"departureDate": res_readi.departureDate,
			"price": res_readi.price,
			"currency": res_readi.currency,
			"duration": res_readi.duration,
			"lastTicketingDate": res_readi.lastTicketingDate,
			"userN": res_readi.userN-1											//decremento
		};

		if(obj["userN"] <1 ) {													//nessun utente l'ha salvato									
			deleteCRUD(itinerariesdb,obj).then(function(res_deli){				//elimino da itineraries
				console.log("Meta eliminata dalle preferite con successo!");
			}).catch(function(err_deli) { console.log(err_deli+": Errore DELETE ITINERARIES"); res.send("useless data"); });
			aux();																
		}
		else{
			updateCRUD(itinerariesdb, obj).then(function(res_updatei) { //... AGGIORNO QUELL'ITINERARIO IN DB (almeno 1 utente lo ha salvato) ...
				aux();													
			}).catch(function(err_updatei) { console.log(err_updatei+": Errore UPDATE ITINERARIES"); res.send("useless data"); });
		}
	}).catch(function(err_readi) { //SE INVECE L'ITINERARIO NON ESISTE IN DB...(errore : in teoria ciò non può accadere)
		console.log(err_readi+": Errore READ ITINERARIES"); res.send("useless data");
	});
});
/*-------------------------------------------*/

function userInfo(token) {
	return new Promise(function(resolve,reject) {
		request.get({url:'https://graph.facebook.com/v10.0/me/?fields=name,email,id,birthday,hometown&access_token='+token}, function (err, res_get, body) {
			if(err) {
				reject("Errore di richiesta dati");
			} else {
				var info= JSON.parse(body);
				resolve(info);
			}
		});
	});
}

function cercaItinerari(origin, destination, departureDate) {
	/*return amadeus.shopping.flightOffersSearch.get({
			originLocationCode: origin,
			destinationLocationCode: destination,
			departureDate: departureDate,
			adults: '1'
		});*/
	
	//TESTING MODE:
	var data = JSON.parse(fs.readFileSync('test_cerca_itinerari.json'));
	return new Promise(function(resolve,reject) {
		if(data.length > 0)
			resolve({"data": data});
		else
			reject("NONONO");
	});
}

const httpServer = https.createServer(options, app);

//Inizio WEBSOCKET
const ws = new WebSocket.Server({ server: httpServer });
CLIENTS=[];
ws.on('connection', function(conn) {
	CLIENTS.push(conn);
	conn.on('message', function(message) {
	console.log('received:  %s', message);
	sendAll(message);

});

console.log("new connection");
	conn.send("NUOVO CLIENTE CONNESSO");

	conn.on('close', function() {
	  console.log("connection closed");
	  CLIENTS.splice(CLIENTS.indexOf(conn), 1);
	});

});

//send messeages vers all clients
function sendAll (message) {
for (var i=0; i<CLIENTS.length; i++) {
 var j=i+1;
 CLIENTS[i].send("Messaggio per il client "+j+": "+message);
}
}
//Fine WEBSOCKET

httpServer.listen(port, function() { 
    console.log(`In ascolto sulla porta ${port}`);
});

//Priorità
/*
	Integrare oauth
	Operazioni CRUD per couchdb
	Coronatracker
	Vedere come funzionano web socket
*/

//'http://admin:admin@localhost:5984/users/'
//COUCHDB: http://127.0.0.1:5984/_utils/#login
app.get('/testcreateCRUD', function(req,res) {
	//INSERISCO NEL SEGUENTE DATABASE: http://admin:admin@localhost:5984/users/
	var obj = {
		"id": 1213123,
		"token": "tokentest",
		"nome": "NOME",
		"mete": []
	};
	createCRUD('http://admin:admin@localhost:5984/users/',obj).then(function(response) {
		console.log(response);
		res.send(response);
	}).catch(function(err) {
		console.log(err);
		res.send(err);
	});
});

app.get('/testreadCRUD', function(req,res) {
	//INSERISCO NEL SEGUENTE DATABASE: http://admin:admin@localhost:5984/users/
	var obj = {
		"id": 1213123,
		"token": "tokentest",
		"nome": "NOME",
		"mete": []
	};
	readCRUD('http://admin:admin@localhost:5984/users/',obj).then(function(response) {
		console.log(response);
		res.send(response);
	}).catch(function(err) {
		console.log(err);
		res.send(err);
	});
});

app.get('/testupdateCRUD', function(req,res) {
	//INSERISCO NEL SEGUENTE DATABASE: http://admin:admin@localhost:5984/users/
	var obj = {
		"id": 1213123,
		"token": "tokentest MODIFICATO UPDATATO",
		"nome": "NOME",
		"mete": []
	};
	updateCRUD('http://admin:admin@localhost:5984/users/',obj).then(function(response) {
		console.log(response);
		res.send(response);
	}).catch(function(err) {
		console.log(err);
		res.send(err);
	});
});

app.get('/testdeleteCRUD', function(req,res) {
	//INSERISCO NEL SEGUENTE DATABASE: http://admin:admin@localhost:5984/users/
	var obj = {
		"id": 1213123,
		"token": "tokentest",
		"nome": "NOME",
		"mete": []
	};
	deleteCRUD('http://admin:admin@localhost:5984/users/',obj).then(function(response) {
		console.log(response);
		res.send(response);
	}).catch(function(err) {
		console.log(err);
		res.send(err);
	});
});

function createCRUD(db,obj) {
	let toinsert = {};
	for(let key in obj) { if(key != "id") toinsert[key] = obj[key];}
	return new Promise(function(resolve, reject){
		request({//url specificato con nome dal docker compose e non localhost
			url: db+obj.id,
			headers: {'content-type': 'application/json'}, 
			method: 'PUT',
			body: JSON.stringify(toinsert)
		}, function(error, res, body){
			if(res.statusCode == 201) { //INSERITO
				resolve(obj);
			} else if(res.statusCode == 409) {//Elemento già presente
				console.log(error);
				console.log(res.statusCode, body);
				reject("Elemento già presente");
				updateCRUD(db,obj);
			}
			else {
				console.log(error);
				console.log(res.statusCode, body);
				reject("Errore, codice: "+res.statusCode);
			}
		});
	});
}

function readCRUD(db,obj) {
	return new Promise(function(resolve, reject){
		request({//url specificato con nome dal docker compose e non localhost
			url: db+obj.id, 
			method: 'GET',
		}, function(error, res, body){
			if(error) reject(error);
			else if(res.statusCode != 200) reject(JSON.parse(body).error)
			else{
				resolve(JSON.parse(body));
			}
		});
	});
}

function updateCRUD(db,obj) {
	let toinsert = {};
	for(let key in obj) { if(key != "id") toinsert[key] = obj[key];}
	return new Promise(function(resolve, reject){
		readCRUD(db,obj).then(function(result) { //prelevo i dati
			toinsert["_rev"] = result._rev;	//aggiungo il _rev a obj per poter fare l'update (altrimenti da errore in accesso)
			request({//url specificato con nome dal docker compose e non localhost
				url: db+obj.id,
				method: 'PUT',
				body: JSON.stringify(toinsert), 
			}, function(error, res){
				if(error) {reject(error);}
				else if(res.statusCode!=201) {reject(res.statusCode);}
				else {
					resolve(true);
				}
			});
		}).catch(function(err){
			reject(err);
		});
	});
}

function deleteCRUD(db,obj) {
	return new Promise(function(resolve, reject){
		readCRUD(db,obj).then(function(result) { //prelevo i dati
			request({//url specificato con nome dal docker compose e non localhost
				url: db+obj.id+"?rev="+result._rev,
				method: 'DELETE',
			}, function(error, res) {
				if(error) {reject(error);}
				else if(res.statusCode!=200){reject(res.statusCode);}
				else {
					resolve(true);
				}
			});
		}).catch(function(err) {
			reject(err);
		});
	});
}

//https://www.facebook.com/dialog/share?app_id=310503350806055&display=popup&href=https://travelfree.altervista.org/&quote=TEST, vota qui: https://locahost:3000/mete

// SEZIONE --- API TERZE
app.get("/api",function(req,res){
	res.sendFile("./public/api.html",{root:__dirname});
});

//Api terze di prova
app.get("/api/metaPiuScelta",function(req,res){
	res.send("La meta più scelta è la Spagna");
});

//API TERZI
/*
	Tutti itinerari salvati
	Più scelte, salvate più volte, con dati covid solo destinazione finale
	Itinerari:
		Relativa a una specifica destinazione
		Relativa a una specifica città di partenza
		Entrambi
	Itinerari ordinati con meno casi attivi
*/