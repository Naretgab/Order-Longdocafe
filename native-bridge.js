/* Long Do Bar — สะพานเชื่อมแอป Android (Capacitor)
   ทำงานเฉพาะตอนรันในแอป APK; บนเบราว์เซอร์/PWA ปกติไม่ทำอะไรเลย
   1) Bluetooth: WebView ไม่มี Web Bluetooth → สร้าง navigator.bluetooth จำลองบน plugin BluetoothLe (โค้ดพิมพ์เดิมใช้ต่อได้เลย)
   2) Push (FCM): ลงทะเบียน token ของเครื่อง + สร้างช่องแจ้งเตือนเสียงดัง "orders"
   3) Keep-awake: ไม่ให้หน้าจอดับตอนเปิดแอป */
(function(){
  "use strict";
  var C = window.Capacitor;
  if(!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  window.IS_NATIVE_APP = true;
  var P = function(n){ return C.registerPlugin(n); };

  /* ---------- 1) Bluetooth LE polyfill ---------- */
  var BLE = P("BluetoothLe"), bleInit = null;
  function ensureBle(){ return bleInit || (bleInit = BLE.initialize({ androidNeverForLocation:true })); }
  function toBase64(v){
    var u = v instanceof Uint8Array ? v : new Uint8Array(v.buffer || v, v.byteOffset || 0, v.byteLength);
    var s = ""; for(var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }
  function makeDevice(id, name){
    var listeners = [], dev = { id:id, name:name || "", gatt:null };
    dev.addEventListener = function(t, fn){ if(t === "gattserverdisconnected") listeners.push(fn); };
    var gatt = { connected:false, device:dev };
    gatt.connect = async function(){
      await ensureBle();
      await BLE.connect({ deviceId:id });
      if(BLE.addListener && !gatt._disconnectListener){
        try{ gatt._disconnectListener = await BLE.addListener("onDisconnect", function(ev){
          if(!ev || ev.deviceId === id){ gatt.connected = false; listeners.forEach(function(f){ try{ f({ target:dev }); }catch(e){} }); }
        }); }catch(e){}
      }
      gatt.connected = true; return gatt;
    };
    gatt.disconnect = async function(){ try{ await BLE.disconnect({ deviceId:id }); }catch(e){} gatt.connected = false; };
    gatt.getPrimaryServices = async function(){
      var r = await BLE.getServices({ deviceId:id });
      return (r.services || []).map(function(sv){
        return { uuid:sv.uuid, getCharacteristics: async function(){
          return (sv.characteristics || []).map(function(ch){
            var props = ch.properties || {};
            return {
              uuid:ch.uuid, properties:{ write:!!props.write, writeWithoutResponse:!!props.writeWithoutResponse },
              writeValue: function(v){ return BLE.write({ deviceId:id, service:sv.uuid, characteristic:ch.uuid, value:toBase64(v) }); },
              writeValueWithoutResponse: function(v){ return BLE.writeWithoutResponse({ deviceId:id, service:sv.uuid, characteristic:ch.uuid, value:toBase64(v) }); }
            };
          });
        } };
      });
    };
    dev.gatt = gatt; return dev;
  }
  var bluetooth = {
    requestDevice: async function(opts){
      await ensureBle();
      var r = await BLE.requestDevice({ optionalServices:(opts && opts.optionalServices) || [] });
      var d = r.device || r;               /* รองรับทั้งรูปแบบ {deviceId,name} และ {device:{...}} */
      try{ localStorage.setItem("bar_bt_id", d.deviceId); }catch(e){}
      var dev = makeDevice(d.deviceId, d.name);
      return dev;
    },
    getDevices: async function(){
      var id = ""; try{ id = localStorage.getItem("bar_bt_id") || ""; }catch(e){}
      if(!id) return [];
      try{ await ensureBle(); var r = await BLE.getDevices({ deviceIds:[id] });
        return (r.devices || []).map(function(d){ return makeDevice(d.deviceId, d.name); }); }catch(e){ return []; }
    }
  };
  try{ Object.defineProperty(navigator, "bluetooth", { value:bluetooth, configurable:true }); }catch(e){ navigator.bluetooth = bluetooth; }

  /* ---------- 3) Keep awake ---------- */
  try{ P("KeepAwake").keepAwake(); }catch(e){}
  document.addEventListener("visibilitychange", function(){ if(!document.hidden){ try{ P("KeepAwake").keepAwake(); }catch(e){} } });

  /* ---------- แชร์/บันทึกรูปบิล (PNG) ผ่านหน้าต่างแชร์ของ Android ---------- */
  window.nativeShareImage = async function(b64, filename, title){
    const FS = P("Filesystem"), SH = P("Share");
    const f = await FS.writeFile({ path:filename, data:b64, directory:"CACHE" });
    await SH.share({ title:title || filename, files:[f.uri], dialogTitle:"แชร์บิล" });
  };

  /* ---------- 2) Push (FCM) ---------- */
  var PN = P("PushNotifications");
  var pushListenersReady = false;
  window.nativePush = {
    init: async function(sb){
      try{
        var perm = await PN.checkPermissions();
        if(perm.receive !== "granted") perm = await PN.requestPermissions();
        if(perm.receive !== "granted"){ window.nativePush.status = "denied"; return "denied"; }
        try{ await PN.createChannel({ id:"orders", name:"ออเดอร์ใหม่", description:"แจ้งเตือนออเดอร์ใหม่",
          importance:5, visibility:1, sound:"alert", vibration:true, lights:true }); }catch(e){}
        if(!pushListenersReady){
          pushListenersReady = true;
          await PN.addListener("registration", async function(t){
            window.nativePush.token = t.value;
            try{
              var u = await sb.auth.getUser();
              var uid = u && u.data && u.data.user && u.data.user.id;
              if(!uid) throw new Error("ไม่พบผู้ใช้ที่เข้าสู่ระบบ");
              var saved = await sb.from("staff_devices").upsert({
                token:t.value, user_id:uid, platform:"android", updated_at:new Date().toISOString()
              }, { onConflict:"token" });
              if(saved.error) throw saved.error;
              window.nativePush.status = "ok";
              if(window.nativePush._resolve){ window.nativePush._resolve("ok"); window.nativePush._resolve = null; }
            }catch(e){
              window.nativePush.status = "save-error: " + (e && e.message || e);
              if(window.nativePush._resolve){ window.nativePush._resolve(window.nativePush.status); window.nativePush._resolve = null; }
            }
          });
          await PN.addListener("registrationError", function(e){
            window.nativePush.status = "error: " + (e && (e.message || e.error) || "ลงทะเบียน FCM ไม่สำเร็จ");
            if(window.nativePush._resolve){ window.nativePush._resolve(window.nativePush.status); window.nativePush._resolve = null; }
          });
        }
        window.nativePush.status = "registering";
        await PN.register();
        return await new Promise(function(resolve){
          window.nativePush._resolve = resolve;
          setTimeout(function(){
            if(window.nativePush._resolve){
              window.nativePush._resolve(window.nativePush.status || "ยังไม่ได้รับ FCM token");
              window.nativePush._resolve = null;
            }
          }, 12000);
        });
      }catch(e){
        window.nativePush.status = "error: " + (e && e.message || e);
        return window.nativePush.status;
      }
    },
    status:"", token:"", _resolve:null
  };
})();
