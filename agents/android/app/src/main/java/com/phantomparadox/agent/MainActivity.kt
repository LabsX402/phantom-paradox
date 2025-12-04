package com.phantomparadox.agent

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import okhttp3.*
import com.google.gson.Gson
import kotlinx.coroutines.*
import java.util.concurrent.TimeUnit

// ============== BACKEND CONNECTION ==============
// Change this to your server URL (localhost for emulator, real IP for device)
const val WS_URL = "ws://10.0.2.2:3000/ws" // 10.0.2.2 = localhost for Android emulator

object AgentBackend {
    private var webSocket: WebSocket? = null
    private var isConnected = false
    private val gson = Gson()
    private val client = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()
    
    var walletAddress: String? = null
    var config: AgentConfig = AgentConfig()
    var onConnectionChange: ((Boolean) -> Unit)? = null
    var onJobReceived: ((String) -> Unit)? = null
    
    data class AgentConfig(
        val cpuLimit: Int = 50,
        val bandwidthLimit: Int = 25,
        val dataQuota: Int = 5,
        val batteryPause: Int = 20
    )
    
    data class HeartbeatMessage(
        val type: String = "heartbeat",
        val agent: String,
        val platform: String = "mobile",
        val version: String = "0.1.6",
        val capabilities: List<String> = listOf("relay", "verify"),
        val config: Map<String, Any>,
        val metrics: Map<String, Any>
    )
    
    fun connect(wallet: String, cfg: AgentConfig) {
        walletAddress = wallet
        config = cfg
        
        if (isConnected) return
        
        val request = Request.Builder()
            .url(WS_URL)
            .build()
        
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d("AgentBackend", "✅ Connected to backend")
                isConnected = true
                onConnectionChange?.invoke(true)
                sendHeartbeat()
            }
            
            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d("AgentBackend", "📩 Message: $text")
                handleMessage(text)
            }
            
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d("AgentBackend", "❌ Closing: $reason")
                isConnected = false
                onConnectionChange?.invoke(false)
            }
            
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e("AgentBackend", "❌ Error: ${t.message}")
                isConnected = false
                onConnectionChange?.invoke(false)
                // Reconnect after 5 seconds
                CoroutineScope(Dispatchers.IO).launch {
                    delay(5000)
                    connect(wallet, cfg)
                }
            }
        })
    }
    
    fun disconnect() {
        webSocket?.close(1000, "User disconnected")
        webSocket = null
        isConnected = false
    }
    
    fun sendHeartbeat() {
        if (!isConnected || walletAddress == null) return
        
        val heartbeat = HeartbeatMessage(
            agent = walletAddress!!,
            config = mapOf(
                "maxBandwidth" to config.bandwidthLimit,
                "dailyDataCap" to config.dataQuota * 1024 // Convert GB to MB
            ),
            metrics = mapOf(
                "latency" to 50,
                "bandwidth" to config.bandwidthLimit,
                "uptime" to 0,
                "bytesToday" to 0
            )
        )
        
        val json = gson.toJson(heartbeat)
        webSocket?.send(json)
        Log.d("AgentBackend", "📡 Heartbeat sent")
    }
    
    private fun handleMessage(text: String) {
        try {
            val msg = gson.fromJson(text, Map::class.java)
            when (msg["type"]) {
                "heartbeat_ack" -> Log.d("AgentBackend", "✅ Heartbeat acknowledged")
                "job_assignment" -> onJobReceived?.invoke(text)
            }
        } catch (e: Exception) {
            Log.e("AgentBackend", "Failed to parse message: $text")
        }
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            PhantomAgentTheme {
                MainApp()
            }
        }
    }
}

@Composable
fun PhantomAgentTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Color(0xFF00FF88),
            secondary = Color(0xFF00D4FF),
            background = Color(0xFF030508),
            surface = Color(0xFF0A0F14),
            onPrimary = Color.Black,
            onSecondary = Color.Black,
            onBackground = Color(0xFFE8F0F8),
            onSurface = Color(0xFFE8F0F8)
        ),
        content = content
    )
}

@Composable
fun MainApp() {
    val context = LocalContext.current
    val prefs = context.getSharedPreferences("agent_config", Context.MODE_PRIVATE)
    
    // State
    var walletAddress by remember { mutableStateOf(prefs.getString("wallet", null)) }
    var currentScreen by remember { mutableStateOf(if (walletAddress != null) "main" else "connect") }
    
    // Config
    var cpuLimit by remember { mutableStateOf(prefs.getInt("cpu", 50)) }
    var bandwidthLimit by remember { mutableStateOf(prefs.getInt("bandwidth", 25)) }
    var batteryPause by remember { mutableStateOf(prefs.getInt("battery_pause", 20)) }
    var dataQuota by remember { mutableStateOf(prefs.getInt("data_quota", 5)) }
    var isRunning by remember { mutableStateOf(false) }
    
    // Screens
    when (currentScreen) {
        "connect" -> WalletConnectScreen(
            onConnected = { wallet ->
                walletAddress = wallet
                prefs.edit().putString("wallet", wallet).apply()
                currentScreen = "main"
            }
        )
        "settings" -> SettingsScreen(
            cpuLimit = cpuLimit,
            bandwidthLimit = bandwidthLimit,
            batteryPause = batteryPause,
            dataQuota = dataQuota,
            onCpuChange = { cpuLimit = it; prefs.edit().putInt("cpu", it).apply() },
            onBandwidthChange = { bandwidthLimit = it; prefs.edit().putInt("bandwidth", it).apply() },
            onBatteryPauseChange = { batteryPause = it; prefs.edit().putInt("battery_pause", it).apply() },
            onDataQuotaChange = { dataQuota = it; prefs.edit().putInt("data_quota", it).apply() },
            onBack = { currentScreen = "main" },
            onDisconnect = {
                walletAddress = null
                prefs.edit().remove("wallet").apply()
                currentScreen = "connect"
            }
        )
        else -> AgentMainScreen(
            walletAddress = walletAddress ?: "",
            isRunning = isRunning,
            cpuLimit = cpuLimit,
            bandwidthLimit = bandwidthLimit,
            dataQuota = dataQuota,
            batteryPause = batteryPause,
            onToggle = { isRunning = !isRunning },
            onSettings = { currentScreen = "settings" }
        )
    }
}

@Composable
fun WalletConnectScreen(onConnected: (String) -> Unit) {
    val context = LocalContext.current
    var manualWallet by remember { mutableStateOf("") }
    var showManualInput by remember { mutableStateOf(false) }
    
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF030508))
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("👛", fontSize = 64.sp)
        
        Spacer(modifier = Modifier.height(24.dp))
        
        Text(
            "Connect Wallet",
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            color = Color(0xFF00FF88)
        )
        
        Text(
            "Required to start earning",
            fontSize = 14.sp,
            color = Color(0xFF6B7C8A),
            modifier = Modifier.padding(top = 8.dp)
        )
        
        Spacer(modifier = Modifier.height(40.dp))
        
        // Phantom Connect Button
        Button(
            onClick = {
                // Deep link to Phantom wallet
                val uri = Uri.parse("https://phantom.app/ul/v1/connect?app_url=https://phantomparadox.io&dapp_encryption_public_key=&redirect_link=phantomagent://callback")
                val intent = Intent(Intent.ACTION_VIEW, uri)
                try {
                    context.startActivity(intent)
                } catch (e: Exception) {
                    showManualInput = true
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF9945FF)),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text("👻 Connect Phantom", fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Manual input option
        TextButton(onClick = { showManualInput = !showManualInput }) {
            Text(
                "Or enter wallet address manually",
                color = Color(0xFF6B7C8A),
                fontSize = 12.sp
            )
        }
        
        if (showManualInput) {
            Spacer(modifier = Modifier.height(16.dp))
            
            OutlinedTextField(
                value = manualWallet,
                onValueChange = { manualWallet = it },
                label = { Text("Solana Wallet Address") },
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color(0xFF00FF88),
                    unfocusedBorderColor = Color(0xFF3A4A5A),
                    focusedLabelColor = Color(0xFF00FF88),
                    cursorColor = Color(0xFF00FF88)
                ),
                singleLine = true
            )
            
            Spacer(modifier = Modifier.height(16.dp))
            
            Button(
                onClick = {
                    if (manualWallet.length >= 32) {
                        onConnected(manualWallet)
                    }
                },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00FF88)),
                shape = RoundedCornerShape(12.dp),
                enabled = manualWallet.length >= 32
            ) {
                Text("Connect", fontWeight = FontWeight.Bold, color = Color.Black)
            }
        }
        
        Spacer(modifier = Modifier.height(40.dp))
        
        Text(
            "⚠️ You must connect a wallet to receive payments",
            fontSize = 11.sp,
            color = Color(0xFFFF9500),
            textAlign = TextAlign.Center
        )
    }
}

@Composable
fun SettingsScreen(
    cpuLimit: Int,
    bandwidthLimit: Int,
    batteryPause: Int,
    dataQuota: Int,
    onCpuChange: (Int) -> Unit,
    onBandwidthChange: (Int) -> Unit,
    onBatteryPauseChange: (Int) -> Unit,
    onDataQuotaChange: (Int) -> Unit,
    onBack: () -> Unit,
    onDisconnect: () -> Unit
) {
    val scrollState = rememberScrollState()
    
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF030508))
            .padding(16.dp)
            .verticalScroll(scrollState)
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "⚙️ Settings",
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF00FF88)
            )
            TextButton(onClick = onBack) {
                Text("Done", color = Color(0xFF00FF88))
            }
        }
        
        Spacer(modifier = Modifier.height(24.dp))
        
        // CPU Limit
        SettingSlider(
            title = "Max CPU Usage",
            value = cpuLimit,
            range = 10f..100f,
            unit = "%",
            onValueChange = { onCpuChange(it.toInt()) }
        )
        
        // Bandwidth Limit
        SettingSlider(
            title = "Max Bandwidth",
            value = bandwidthLimit,
            range = 1f..100f,
            unit = " Mbps",
            onValueChange = { onBandwidthChange(it.toInt()) }
        )
        
        // Data Quota
        SettingSlider(
            title = "Daily Data Quota",
            value = dataQuota,
            range = 1f..50f,
            unit = " GB/day",
            onValueChange = { onDataQuotaChange(it.toInt()) }
        )
        
        // Battery Pause Level
        SettingSlider(
            title = "Pause at Battery",
            value = batteryPause,
            range = 5f..50f,
            unit = "%",
            onValueChange = { onBatteryPauseChange(it.toInt()) }
        )
        
        Spacer(modifier = Modifier.height(32.dp))
        
        // Job Types
        Text(
            "Job Types",
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            color = Color(0xFFE8F0F8)
        )
        Spacer(modifier = Modifier.height(12.dp))
        
        JobTypeToggle("🔗 Relay (VPN Traffic)", true)
        JobTypeToggle("✓ Verify (Proofs)", true)
        JobTypeToggle("📸 AI Image", false)
        JobTypeToggle("🎤 AI Audio", false)
        
        Spacer(modifier = Modifier.height(32.dp))
        
        // Payment Token
        Text(
            "Payment Token",
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            color = Color(0xFFE8F0F8)
        )
        Spacer(modifier = Modifier.height(12.dp))
        
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PaymentOption("◎ SOL", true, Modifier.weight(1f))
            PaymentOption("💵 USDC", false, Modifier.weight(1f))
        }
        
        Text(
            "USDC: Auto-swap via Jupiter",
            fontSize = 10.sp,
            color = Color(0xFF6B7C8A),
            modifier = Modifier.padding(top = 8.dp)
        )
        
        Spacer(modifier = Modifier.height(40.dp))
        
        // Disconnect Wallet
        OutlinedButton(
            onClick = onDisconnect,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFFF4757)),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text("Disconnect Wallet")
        }
        
        Spacer(modifier = Modifier.height(24.dp))
    }
}

@Composable
fun SettingSlider(
    title: String,
    value: Int,
    range: ClosedFloatingPointRange<Float>,
    unit: String,
    onValueChange: (Float) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF0A0F14)),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(title, color = Color(0xFFE8F0F8), fontSize = 14.sp)
                Text("$value$unit", color = Color(0xFF00FF88), fontWeight = FontWeight.Bold)
            }
            Spacer(modifier = Modifier.height(8.dp))
            Slider(
                value = value.toFloat(),
                onValueChange = onValueChange,
                valueRange = range,
                colors = SliderDefaults.colors(
                    thumbColor = Color(0xFF00FF88),
                    activeTrackColor = Color(0xFF00FF88)
                )
            )
        }
    }
}

@Composable
fun JobTypeToggle(label: String, enabled: Boolean) {
    var isEnabled by remember { mutableStateOf(enabled) }
    
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .clickable { isEnabled = !isEnabled },
        colors = CardDefaults.cardColors(
            containerColor = if (isEnabled) Color(0xFF00FF88).copy(alpha = 0.1f) else Color(0xFF0A0F14)
        ),
        shape = RoundedCornerShape(8.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(label, color = Color(0xFFE8F0F8))
            Switch(
                checked = isEnabled,
                onCheckedChange = { isEnabled = it },
                colors = SwitchDefaults.colors(
                    checkedThumbColor = Color(0xFF00FF88),
                    checkedTrackColor = Color(0xFF00FF88).copy(alpha = 0.5f)
                )
            )
        }
    }
}

@Composable
fun PaymentOption(label: String, selected: Boolean, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(
            containerColor = if (selected) Color(0xFF00FF88).copy(alpha = 0.2f) else Color(0xFF0A0F14)
        ),
        shape = RoundedCornerShape(8.dp)
    ) {
        Box(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                label,
                color = if (selected) Color(0xFF00FF88) else Color(0xFF6B7C8A),
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal
            )
        }
    }
}

@Composable
fun AgentMainScreen(
    walletAddress: String,
    isRunning: Boolean,
    cpuLimit: Int,
    bandwidthLimit: Int,
    dataQuota: Int,
    batteryPause: Int,
    onToggle: () -> Unit,
    onSettings: () -> Unit
) {
    var earnings by remember { mutableStateOf(0.0) }
    var dataRelayed by remember { mutableStateOf(0.0) }
    var uptime by remember { mutableStateOf(0L) }
    var backendConnected by remember { mutableStateOf(false) }
    
    // Connect to backend when running
    LaunchedEffect(isRunning) {
        if (isRunning) {
            AgentBackend.onConnectionChange = { connected ->
                backendConnected = connected
            }
            AgentBackend.connect(
                walletAddress,
                AgentBackend.AgentConfig(cpuLimit, bandwidthLimit, dataQuota, batteryPause)
            )
        } else {
            AgentBackend.disconnect()
            backendConnected = false
        }
    }
    
    // Send heartbeats every 30 seconds when running
    LaunchedEffect(isRunning) {
        while (isRunning) {
            kotlinx.coroutines.delay(1000)
            uptime++
            dataRelayed += 0.01
            earnings += 0.000001
            
            // Send heartbeat every 30 seconds
            if (uptime % 30 == 0L) {
                AgentBackend.sendHeartbeat()
            }
        }
    }
    
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF030508))
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Header with wallet
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text("PHANTOM AGENT", color = Color(0xFF00FF88), fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text(
                    "👛 ${walletAddress.take(4)}...${walletAddress.takeLast(4)}",
                    color = Color(0xFF6B7C8A),
                    fontSize = 12.sp
                )
            }
            IconButton(onClick = onSettings) {
                Text("⚙️", fontSize = 24.sp)
            }
        }
        
        Spacer(modifier = Modifier.height(32.dp))
        
        // Status Circle
        Box(
            modifier = Modifier
                .size(150.dp)
                .clip(CircleShape)
                .background(
                    if (isRunning && backendConnected) Color(0xFF00FF88).copy(alpha = 0.2f) 
                    else if (isRunning) Color(0xFFFFAA00).copy(alpha = 0.2f)
                    else Color(0xFF1A2530)
                ),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    if (isRunning && backendConnected) "🟢" 
                    else if (isRunning) "🟡"
                    else "⭕",
                    fontSize = 48.sp
                )
                Text(
                    if (isRunning && backendConnected) "CONNECTED" 
                    else if (isRunning) "CONNECTING..."
                    else "OFFLINE",
                    color = if (isRunning && backendConnected) Color(0xFF00FF88) 
                           else if (isRunning) Color(0xFFFFAA00)
                           else Color(0xFF6B7C8A),
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp
                )
                if (isRunning && backendConnected) {
                    Text("📡 Live", color = Color(0xFF00FF88).copy(alpha = 0.7f), fontSize = 10.sp)
                }
            }
        }
        
        Spacer(modifier = Modifier.height(24.dp))
        
        // Earnings
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF00FF88).copy(alpha = 0.1f)),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    "${String.format("%.6f", earnings)} SOL",
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF00FF88)
                )
                Text("Session Earnings", color = Color(0xFF6B7C8A), fontSize = 12.sp)
            }
        }
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Stats
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatCard("Data", "${String.format("%.2f", dataRelayed)} MB", Modifier.weight(1f))
            StatCard("Uptime", formatTime(uptime), Modifier.weight(1f))
        }
        
        Spacer(modifier = Modifier.height(12.dp))
        
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatCard("CPU Limit", "$cpuLimit%", Modifier.weight(1f))
            StatCard("BW Limit", "$bandwidthLimit Mbps", Modifier.weight(1f))
        }
        
        Spacer(modifier = Modifier.weight(1f))
        
        // Start/Stop Button
        Button(
            onClick = onToggle,
            modifier = Modifier.fillMaxWidth().height(60.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = if (isRunning) Color(0xFFFF4757) else Color(0xFF00FF88)
            ),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text(
                if (isRunning) "⏹ STOP" else "▶ START EARNING",
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                color = if (isRunning) Color.White else Color.Black
            )
        }
        
        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = Color(0xFF0A0F14)),
        shape = RoundedCornerShape(8.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(value, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color(0xFF00FF88))
            Text(label, fontSize = 10.sp, color = Color(0xFF6B7C8A))
        }
    }
}

fun formatTime(seconds: Long): String {
    val h = seconds / 3600
    val m = (seconds % 3600) / 60
    val s = seconds % 60
    return "${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}"
}
