package com.phantomparadox.agent

import android.app.Application
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AgentState(
    val isRunning: Boolean = false,
    val walletAddress: String? = null,
    val earnings: Double = 0.0,
    val dataRelayedMb: Double = 0.0,
    val uptimeSeconds: Long = 0,
    val batteryLevel: Int = 100,
    val hourlyRate: Double = 0.0,
    val isWifiConnected: Boolean = true
)

class AgentViewModel(application: Application) : AndroidViewModel(application) {
    
    private val _state = MutableStateFlow(AgentState())
    val state: StateFlow<AgentState> = _state.asStateFlow()
    
    private var startTime: Long = 0
    
    init {
        // Start battery monitoring
        viewModelScope.launch {
            while (true) {
                updateBatteryLevel()
                if (_state.value.isRunning) {
                    updateStats()
                }
                delay(5000) // Update every 5 seconds
            }
        }
    }
    
    fun toggleAgent() {
        viewModelScope.launch {
            if (_state.value.isRunning) {
                stopAgent()
            } else {
                startAgent()
            }
        }
    }
    
    private fun startAgent() {
        // Check battery level
        if (_state.value.batteryLevel < 15) {
            // Don't start if battery too low
            return
        }
        
        startTime = System.currentTimeMillis()
        _state.value = _state.value.copy(
            isRunning = true,
            uptimeSeconds = 0
        )
        
        // TODO: Start actual relay service
        // context.startForegroundService(Intent(context, AgentService::class.java))
    }
    
    private fun stopAgent() {
        _state.value = _state.value.copy(isRunning = false)
        
        // TODO: Stop relay service
        // context.stopService(Intent(context, AgentService::class.java))
    }
    
    private fun updateBatteryLevel() {
        val batteryStatus: Intent? = IntentFilter(Intent.ACTION_BATTERY_CHANGED).let { filter ->
            getApplication<Application>().registerReceiver(null, filter)
        }
        
        val level = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val batteryPct = if (level >= 0 && scale > 0) (level * 100 / scale) else 100
        
        _state.value = _state.value.copy(batteryLevel = batteryPct)
        
        // Auto-stop if battery critical
        if (batteryPct < 15 && _state.value.isRunning) {
            stopAgent()
        }
    }
    
    private fun updateStats() {
        val elapsed = (System.currentTimeMillis() - startTime) / 1000
        
        // Simulate relay activity (replace with real metrics)
        val mbRelayed = _state.value.dataRelayedMb + (Math.random() * 0.1)
        val earnings = mbRelayed * 0.001 // $0.001 per MB
        val hourlyRate = if (elapsed > 0) (earnings / elapsed * 3600) else 0.0
        
        _state.value = _state.value.copy(
            uptimeSeconds = elapsed,
            dataRelayedMb = mbRelayed,
            earnings = earnings,
            hourlyRate = hourlyRate
        )
    }
}

