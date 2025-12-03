package com.phantomparadox.agent

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            PhantomAgentTheme {
                AgentScreen()
            }
        }
    }
}

@Composable
fun PhantomAgentTheme(content: @Composable () -> Unit) {
    val colorScheme = darkColorScheme(
        primary = Color(0xFF00FF88),
        secondary = Color(0xFF00D4FF),
        background = Color(0xFF030508),
        surface = Color(0xFF0A0F14),
        onPrimary = Color.Black,
        onSecondary = Color.Black,
        onBackground = Color(0xFFE8F0F8),
        onSurface = Color(0xFFE8F0F8)
    )
    
    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}

@Composable
fun AgentScreen(viewModel: AgentViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Header
        Text(
            text = "phantom_paradox",
            color = MaterialTheme.colorScheme.primary,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(vertical = 16.dp)
        )
        
        // Status Indicator
        Box(
            modifier = Modifier
                .size(120.dp)
                .clip(CircleShape)
                .background(
                    if (state.isRunning) 
                        MaterialTheme.colorScheme.primary.copy(alpha = 0.2f)
                    else 
                        Color(0xFF1A2530)
                ),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = if (state.isRunning) "●" else "○",
                fontSize = 48.sp,
                color = if (state.isRunning) 
                    MaterialTheme.colorScheme.primary 
                else 
                    Color(0xFF6B7C8A)
            )
        }
        
        Spacer(modifier = Modifier.height(16.dp))
        
        Text(
            text = if (state.isRunning) "ONLINE" else "OFFLINE",
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground
        )
        
        Text(
            text = if (state.isRunning) "Relaying traffic..." else "Tap to start earning",
            fontSize = 14.sp,
            color = Color(0xFF6B7C8A)
        )
        
        Spacer(modifier = Modifier.height(24.dp))
        
        // Earnings Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)
            ),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = "$${String.format("%.4f", state.earnings)}",
                    fontSize = 32.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = "Session Earnings",
                    fontSize = 12.sp,
                    color = Color(0xFF6B7C8A)
                )
            }
        }
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Stats Grid
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            StatCard("Data", "${state.dataRelayedMb} MB", Modifier.weight(1f))
            StatCard("Uptime", formatUptime(state.uptimeSeconds), Modifier.weight(1f))
        }
        
        Spacer(modifier = Modifier.height(12.dp))
        
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            StatCard("Battery", "${state.batteryLevel}%", Modifier.weight(1f))
            StatCard("Rate", "$${String.format("%.2f", state.hourlyRate)}/hr", Modifier.weight(1f))
        }
        
        Spacer(modifier = Modifier.weight(1f))
        
        // Battery Warning
        if (state.batteryLevel < 20 && state.isRunning) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = Color(0xFFFF9500).copy(alpha = 0.2f)
                )
            ) {
                Text(
                    text = "⚠️ Low battery - Agent will pause at 15%",
                    modifier = Modifier.padding(12.dp),
                    color = Color(0xFFFF9500),
                    fontSize = 12.sp
                )
            }
            Spacer(modifier = Modifier.height(12.dp))
        }
        
        // Main Button
        Button(
            onClick = { viewModel.toggleAgent() },
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = if (state.isRunning) 
                    Color(0xFFFF4757) 
                else 
                    MaterialTheme.colorScheme.primary
            ),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text(
                text = if (state.isRunning) "STOP" else "START EARNING",
                fontWeight = FontWeight.Bold
            )
        }
        
        Spacer(modifier = Modifier.height(8.dp))
        
        // Settings Button
        OutlinedButton(
            onClick = { /* TODO: Open settings */ },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text("Settings")
        }
    }
}

@Composable
fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        shape = RoundedCornerShape(8.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = value,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
            Text(
                text = label,
                fontSize = 10.sp,
                color = Color(0xFF6B7C8A)
            )
        }
    }
}

fun formatUptime(seconds: Long): String {
    val hours = seconds / 3600
    val mins = (seconds % 3600) / 60
    return "$hours:${mins.toString().padStart(2, '0')}"
}

